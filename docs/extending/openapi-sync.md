# OpenAPI sync & contract tasks

This guide is for contributors (human or bot) doing **OpenAPI maintenance**: keeping the
mock's API surface honest against the real Mastodon API. If you're implementing a missing
endpoint, closing a response-shape gap, or refreshing the upstream schema, start here.

For the design and phasing, see [`spec/openapi_support.md`](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/openapi_support.md).
For general contribution setup, see [Contributing](CONTRIBUTING.md).

## The two contracts

There are two independent OpenAPI 3.1.0 descriptions of "the Mastodon API" in play:

| | what | where |
| --- | --- | --- |
| **truth** | the real Mastodon API, generated from upstream docs | `mastodon-openapi/dist/schema.json` (a *vendored, untracked* checkout of [abraham/mastodon-openapi](https://github.com/abraham/mastodon-openapi)) |
| **mock** | what `mastodon_mock` actually serves | `GET /openapi.json` from the running app (FastAPI auto-generates it); also browsable at `/docs` (Swagger UI) and `/redoc` |

Everything below is about detecting and closing the gap between them.

> **Heads-up: the truth schema is not committed.** `mastodon-openapi/` is a local
> checkout, not part of this repo's git history and not a submodule. All the tooling
> *skips gracefully* when it's absent. To work on these tasks you must vendor it first
> (next section).

## One-time setup

```bash
# From the repo root — clone the upstream generator next to the mock.
git clone --depth 1 https://github.com/abraham/mastodon-openapi.git

# (Optional) regenerate the schema from the very latest Mastodon docs instead of using
# the committed dist/schema.json:
cd mastodon-openapi && npm ci && npm run update-docs && npm run generate && cd ..

# Install the optional contract-fuzzing dependency (schemathesis) when you need Phase 3:
uv sync --extra contract
```

## The tools, in order of cost

### 1. Spec-vs-spec comparison (instant, deterministic)

Diffs the two contracts structurally — which operations each side has, and whether shared
operations agree on required query params. Path parameters are name-normalized
(`{account_id}` ≡ `{id}`) so only real structural differences show up.

```bash
# Human-readable summary to stdout:
uv run mastodon_mock compare-openapi

# Regenerate the committed report and print the summary:
make compare-openapi          # writes spec/openapi_compare_report.md

# Other formats / fail-on-drift for scripts:
uv run mastodon_mock compare-openapi --format json
uv run mastodon_mock compare-openapi --strict     # exit 1 on un-allow-listed drift
```

It classifies every operation as:

- **shared** — in both. Good.
- **mock-only** — we serve it, upstream doesn't. Either intentional (control plane, admin,
  UI, well-known) → allow-list it; or an accident → fix it.
- **truth-only** — real endpoint we don't implement → the **coverage backlog**.
- **param mismatch** — shared op where required query params disagree.

### 2. Contract guard-rail tests (fast, runs in the normal suite)

```bash
uv run pytest tests/test_openapi_contract.py
```

These turn the comparison into a ratchet (see [the allow-list](#the-allow-list) below).
They run in the default `make test` / CI suite and fail on **new, unrecorded** drift.

### 3. Live fuzzing with Schemathesis (slow, opt-in)

Boots a real `MockServer` and throws generated requests at every shared read-only
endpoint, checking the responses against the truth schema. **Opt-in**: marked `contract`
(deselected by default) and needs the `contract` extra.

```bash
uv sync --extra contract

# Default mode — asserts only "the mock never 500s" on the shared GET surface:
uv run pytest -m contract tests/test_openapi_fuzz.py

# Strict/reporting mode — also asserts full schema conformance (status code, content
# type, response body shape). Expect many failures today; this is the gap finder:
CONTRACT_STRICT=1 uv run pytest -m contract tests/test_openapi_fuzz.py
```

> Strict mode is intentionally **not** wired into a blocking CI job yet — there are too
> many open response-shape gaps. It is the instrument for *finding* them, endpoint by
> endpoint, until Phase 4 closes them and it can be promoted to a gate.

The fuzz module has two exclusion knobs:

- `NOT_FUZZABLE_PREFIXES` — paths that can't be fuzzed over plain request/response (e.g.
  `/api/v1/streaming/*`, which are Server-Sent-Events and never return a normal body).
  These are excluded structurally, not treated as divergence.
- `QUARANTINE` — shared operations whose responses are known to diverge (see the response
  -shape playbook below).

> Default-mode fuzzing already paid for itself: its first run found two `500`-on-bad-input
> bug classes (non-numeric pagination cursors, and out-of-range `limit`/`offset`
> overflowing SQLite), now fixed via `clamp_limit` / `clamp_offset` / `coerce_cursor` in
> `pagination.py`. That's the kind of robustness bug this layer is meant to catch.

## The allow-list

`tests/openapi/allowlist.py` is the single reviewed record of intended divergence. It has
three sections, each keyed by `(METHOD, normalized_path)` with a short reason:

- `MOCK_ONLY` — operations we serve that upstream lacks, on purpose.
- `TRUTH_ONLY` — the unimplemented-endpoint backlog (with `MAX_TRUTH_ONLY` as a cap that
  only goes down).
- `PARAM_MISMATCH_ALLOW` — shared ops whose required params legitimately differ.

The contract tests enforce three invariants:

1. **No surprise endpoints** — every mock-only op must be in `MOCK_ONLY`.
1. **No silent gaps** — every truth-only op must be in `TRUTH_ONLY`.
1. **No stale entries** — an allow-list entry that no longer matches real drift fails the
   tests, so the lists can't rot.

## Task playbooks

### Implementing a missing endpoint (closing a `truth_only` gap)

The expected workflow for the bot/contributor filling in coverage:

1. **Pick a target** from `spec/openapi_compare_report.md` → *Truth-only operations*, or
   from `TRUTH_ONLY` in the allow-list. Cross-reference `spec/03-api-coverage.md`.
1. **Learn the real shape.** The mock has no live Mastodon to copy, so capture the real
   response — e.g. against `mastodon.social` or any public instance:
   ```bash
   curl -s https://mastodon.social/api/v1/instance/privacy_policy | jq .
   ```
   For authed endpoints, register an app and use a token (see Mastodon's API docs). Also
   read the operation's schema in `mastodon-openapi/dist/schema.json` — that's the
   contract you're implementing to.
1. **Implement** the route in the appropriate `mastodon_mock/routers/*.py`, serializing
   via `mastodon_mock/serializers/*` so the JSON matches the truth `components.schemas`.
1. **Remove it from `TRUTH_ONLY`** in `tests/openapi/allowlist.py` and **lower
   `MAX_TRUTH_ONLY`** by the number you implemented.
1. **Regenerate & verify:**
   ```bash
   make compare-openapi
   uv run pytest tests/test_openapi_contract.py
   CONTRACT_STRICT=1 uv run pytest -m contract tests/test_openapi_fuzz.py \
       -k '<your-path-fragment>'   # confirm the new endpoint conforms
   ```
1. Commit the route, the serializer, the allow-list edit, and the regenerated
   `spec/openapi_compare_report.md` together.

### Fixing a response-shape gap (Phase 4 work)

Strict-mode fuzzing (or a real-vs-mock diff) flags where the body diverges. Fix the
serializer/handler so the body matches the truth `components.schemas`, then re-run strict
fuzzing on that path.

Some divergences are **intentional** — e.g. the mock returns `404 → {"detail": "..."}`
(a documented convention in [Contributing](CONTRIBUTING.md#conventions), tolerated by
Mastodon.py) where the upstream schema models `{"error": "..."}`. For those, add the op
to `QUARANTINE` in `tests/test_openapi_fuzz.py` with a reason rather than "fixing" it
(mirrors the allow-list philosophy). Use judgement: prefer fixing real shape gaps;
quarantine only deliberate, client-compatible differences.

### Refreshing the upstream truth schema

The real API moves; periodically re-vendor it:

```bash
cd mastodon-openapi && git pull && npm ci && npm run generate && cd ..
make compare-openapi
uv run pytest tests/test_openapi_contract.py
```

New upstream endpoints surface as **new truth-only** entries (the tests will fail until
you record them in `TRUTH_ONLY`). Renamed/removed upstream endpoints surface as **stale
allow-list entries** or new mock-only ops. The diff in `spec/openapi_compare_report.md`
is your changelog of what moved upstream.

The [`openapi-drift` workflow](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/.github/workflows/openapi-drift.yml)
automates this weekly: it clones the upstream generator, runs the comparison, enforces
the contract tests, and uploads the regenerated report as an artifact.

### Flagging an intentional mock-only endpoint

Added a `/_mock/*`, admin, or other deliberately-non-Mastodon route? The contract test
will fail with "operations absent from upstream and not in allow-list". Add it to
`MOCK_ONLY` in `tests/openapi/allowlist.py` with a one-line reason, then re-run the tests.

## Quick reference

| I want to… | command |
| --- | --- |
| See the contract diff | `uv run mastodon_mock compare-openapi` |
| Regenerate the committed report | `make compare-openapi` |
| Run the guard-rail tests | `uv run pytest tests/test_openapi_contract.py` |
| Find response-shape gaps | `CONTRACT_STRICT=1 uv run pytest -m contract tests/test_openapi_fuzz.py` |
| Browse the mock's live contract | open `/docs` on a running server |
| Refresh the truth schema | `cd mastodon-openapi && git pull && npm run generate` |
