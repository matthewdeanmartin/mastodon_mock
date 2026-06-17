# Performance Design Notes

Audience: **contributors**. This page records the performance-relevant design
decisions for `mastodon_mock` — what we optimized, what we deliberately did *not*, and
the measurements behind each call. The goal is to stop the same "shouldn't we use the
fast native library for X?" question from being re-litigated every few months without
data.

See also [spec/09-sample-data-and-perf.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/09-sample-data-and-perf.md)
for the bulk sample-data generator and the benchmark/baseline harness (`tests/perf/`,
`make perf`).

## Guiding principle

`mastodon_mock` is a **local, single-process, throwaway test target** backed by SQLite.
"Fast enough that it never shows up in a test suite's profile" is the bar — not
maximum throughput. So the rule for adopting a native/compiled dependency is:

> Add it only where there is a **measured** hot path *and* the library actually wins
> *on this stack and platform*. A faster library that the framework routes around, or
> that optimizes a path we hit once per process, is just extra supply-chain surface.

Every claim below is backed by a microbenchmark you can re-run; numbers are from a
Windows 11 / CPython 3.13 dev box and are **relative**, not absolute.

## Decisions

### JSON encoding — `orjson` is a dependency, but **not** the response class

`orjson` is a hard dependency (`pyproject.toml [project].dependencies`). It is used for
explicit JSON work where we control the call — e.g. the `gen-data --json` report output
(`cli.py`).

In isolation orjson is dramatically faster than the stdlib:

```
PURE ENCODE  orjson 3.8 us  vs json 26.9 us   (~7x)   # 20-status timeline payload
```

The tempting move is `FastAPI(default_response_class=ORJSONResponse)` so every endpoint
encodes via orjson. **We do not do this**, for two measured reasons on the pinned
FastAPI (0.137) / Starlette (1.3) stack:

1. **It's deprecated.** FastAPI 0.137 emits a `FastAPIDeprecationWarning` for
   `ORJSONResponse` (as a default class *or* a returned instance): "FastAPI now
   serializes data directly to JSON bytes … which is faster and doesn't need a custom
   response class." Using it added ~250 warnings to the test run.

1. **It's actually slower for our endpoints.** Our list endpoints return untyped
   `list[dict[str, Any]]`, not Pydantic models. Forcing `ORJSONResponse` makes FastAPI
   run `jsonable_encoder` over the payload and *then* re-encode with orjson, which loses
   to the framework's built-in path:

   ```
   ENDPOINT  default 3319 us/req   vs   ORJSONResponse 4905 us/req
   ```

   (Whole-request time through `TestClient`, 20-status payload. Per-request cost is
   dominated by routing/ASGI, not the encoder — which is exactly why swapping the
   encoder doesn't help and the extra `jsonable_encoder` pass hurts.)

**Takeaway:** keep `orjson` for code we own that does bulk `dumps`/`loads`; let FastAPI
own response serialization. Revisit only if a future FastAPI removes its native fast
path or we move hot endpoints to typed response models.

### TOML parsing — keep stdlib `tomllib`, do **not** add `rtoml`

Config is parsed by `tomllib` (stdlib, C-accelerated) in `config.py::_read_toml`.

`rtoml` (Rust) parses faster per call, but the relevant question is *how often we
parse*, and the answer is **once**:

- `MastodonMockConfig.load()` is called exactly once at app-factory time
  (`app.py::create_app`) and once per CLI invocation (`cli.py`). It is never on a
  request path.

- A full parse of a realistic config costs ~30 µs:

  ```
  tomllib parse: 30.0 us/call
  ```

Shaving a fraction of 30 µs *once per server boot* is unmeasurable in any real
workflow, and `rtoml` would add a compiled dependency (wheels per platform, a build
fallback) for that non-win. **Not worth it.** If config ever moves onto a hot path
(e.g. hot-reload per request — which it should not), revisit.

### HTTP client / test transport — migrated to `httpx2`

Starlette 1.3's `TestClient` and our own test helpers
(`mastodon_mock.testing.MockServer.reset`, the `tests/` suite) now use **`httpx2`**
(`import httpx2 as httpx`). Starlette deprecated using plain `httpx` with its test
client (one `StarletteDeprecationWarning` per `TestClient` use); `httpx2` is its
maintained successor and an API-compatible drop-in for everything we touch (`Client`,
`ASGITransport`, `get`/`post`, `Response`). `httpx2` ships in the public `test` extra
(`mastodon_mock[test]`) so consumers of the testing sugar get it too.

This is a deprecation/maintenance migration, not a throughput optimization — but it
lives here because it's the same "which client library" question.

### SQLite & SQLAlchemy — sync, with concurrency PRAGMAs on every connection

The mock uses **sync** SQLAlchemy + SQLite by design (see
[spec/01-architecture.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/01-architecture.md)).
Per-request read performance was addressed where it mattered (see finding **F1** in
spec/09: batched serialization collapsed a timeline-page N+1 from ~260 queries to a
handful, ~4–9x faster reads). The bulk generator applies aggressive `PRAGMA synchronous=OFF` / `journal_mode` tuning for the duration of a load
(`db/sample_data.py::_bulk_load_pragmas`).

Because `:memory:` is backed by a private **temp file** (so each threadpool request
gets its own connection — see `db/base.py::init_engine`), the request path is genuinely
concurrent: long-lived SSE streams read while ordinary requests write. SQLite's defaults
serialize that badly — rollback journaling makes a writer block all readers, and
`busy_timeout=0` makes a thread that hits a held lock fail immediately with
`SQLITE_BUSY`. Under `pytest -n auto` that showed up as stalls and flaky stream
timeouts. So `init_engine` installs a `connect`-event listener
(`db/base.py::_tune_sqlite_connection`) that applies, to **every** pooled connection:

| PRAGMA | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Readers and the single writer run concurrently instead of blocking each other. |
| `busy_timeout` | `5000` (ms) | A contended writer waits briefly rather than erroring out. |
| `synchronous` | `NORMAL` | WAL-safe, far fewer fsyncs; durability across power loss is irrelevant for an ephemeral DB. |

Measured effect: the full suite under `-n auto` dropped from ~1m20s to ~38s locally,
and the intermittent streaming `TimeoutError` disappeared. The WAL `-wal`/`-shm`
sidecar files are cleaned up alongside the temp DB on `engine.dispose()`
(`db/base.py::_delete_on_dispose`), preserving the "leaves nothing behind" `:memory:`
contract.

We have **not** adopted an async driver (`aiosqlite`) or an alternative SQLite binding:
with WAL the workload is read-mostly with brief, well-coordinated writes, so async would
add complexity without throughput.

## Native libraries we evaluated and declined

| Library | Use | Verdict | Why |
|---|---|---|---|
| `orjson` | JSON encode | **Adopted** (explicit use only) | ~7x encode; but **not** as FastAPI response class — deprecated there and slower for our untyped-dict endpoints. |
| `httpx2` | test HTTP client | **Adopted** | Starlette-recommended successor; removes deprecation warning; drop-in. |
| `rtoml` | TOML parse | **Declined** | Config parsed once per process (~30 µs); a compiled dep for no measurable gain. |
| `uvloop` | event loop | **Declined** | Not available on Windows (a primary dev/CI platform); benefit is for high-concurrency network servers, not a local test target. |
| `httptools` | HTTP parser | **Declined** | Same rationale as uvloop — concurrency win we don't need; pure-Python `h11` is fine at this scale. |
| `aiosqlite` / async SQLAlchemy | DB | **Declined** | With WAL + `busy_timeout` the threadpool connections coordinate fine (see above); async adds complexity, not speed. |
| `msgspec` | serialize/validate | **Declined** | Would mean replacing Pydantic/FastAPI's response handling wholesale; FastAPI already owns the fast path. |

## How to re-check these claims

The microbenchmarks above are intentionally tiny and standalone — paste them into
`uv run python -` to reproduce. For the end-to-end read/generation benchmarks and the
regression baselines, run:

```bash
make perf            # pytest -m slow  (generation throughput + read-latency P95)
```

If you're proposing a native swap-in, bring numbers from `make perf` (or an equivalent
endpoint benchmark) showing a win **through FastAPI on the supported platforms**, not
just a library-in-isolation microbenchmark.
