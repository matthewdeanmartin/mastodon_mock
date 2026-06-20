# Sample Data Generation & Performance

## Goals

- Generate **realistic-volume** mock worlds — hundreds to low tens of thousands of
  accounts/statuses/edges — fast enough to be usable interactively (a UI button and a
  CLI command), to stress-test the mock and find where it falls over.
- Find and push back the **failure points**: this is a SQLite + sync-SQLAlchemy
  in-process mock. It is *not* expected to survive millions/billions of rows. Part of
  the deliverable is discovering the practical ceiling (e.g. "10k accounts × 1k posts is
  ~10M status rows and seed takes Ns / queries degrade to Ms") and documenting it.
- Establish **performance baselines** and a regression guard so a future change that,
  say, drops an index or N+1's a serializer is caught as a big regression rather than
  silently shipped.

### Non-goals

- Distributed/parallel generation, external data stores, or anything beyond a single
  SQLite file. If a shape is too big for SQLite, the answer is "use a smaller shape",
  not "add Postgres".
- Statistical realism of *content* (we generate plausible-but-fake usernames and lorem
  text, not a faithful social-graph distribution). Edge counts are configurable; their
  *distribution* is uniform/random, good enough to exercise pagination, joins, and
  fan-out.
- Replacing the existing idempotent [seed](07-seeding-and-fixtures.md). Seed = a small,
  named, deterministic "world" you assert against. Sample data = bulk, throwaway,
  volume. The two are independent and composable (seed runs first; sample data piles on
  top).

## Why a separate path from `apply_seed_data`

`apply_seed_data` is **find-or-create, one row at a time, with `flush()` per account**
and full ORM bookkeeping (it routes follows through `do_follow`, parses mentions/tags
per status). That is correct and idempotent but O(rows) round-trips — fine for a dozen
seed rows, catastrophic for 10⁶. The sample-data generator instead:

- Uses **bulk inserts** (`session.execute(insert(Table), [dict, dict, ...])` /
  `bulk_insert_mappings`) in chunks, not per-row `add()` + `flush()`.
- **Pre-allocates IDs** in-process from `ids.next_id()` (or a fast local counter seeded
  from it) so it can wire up foreign keys (status.account_id, relationship edges,
  favourites) *without* round-tripping to read back generated PKs.
- Skips notification/mention/tag side effects by default (a `--rich`/`with_engagement`
  flag can turn a subset on), because those are the per-row-expensive parts.
- Wraps everything in one transaction (or a handful of chunked commits) with SQLite
  `PRAGMA`s tuned for bulk load (`synchronous=OFF`, `journal_mode=MEMORY` for
  `:memory:`; `WAL` for file DBs) applied only for the load and restored after.

It is **not idempotent** — it always *appends* a fresh cohort. Re-running doubles the
data. (Use `/_mock/reset` or a fresh DB to start clean.) This is intentional: idempotency
checks are exactly the per-row `SELECT`s we're trying to avoid.

## Config shape (TOML)

A new `[tool.mastodon_mock.sample_data]` table describes the **shape** of a generated
cohort. It is *not* applied at startup (unlike `seed`); it is the **default profile**
used by the CLI command and the UI button when no explicit numbers are given.

```toml
[tool.mastodon_mock.sample_data]
accounts = 5000              # number of accounts to create
followers_per_account = 1000 # outgoing follow edges per account (clamped to accounts-1)
statuses_per_account = 1000  # statuses authored per account
reply_ratio = 0.2            # fraction of statuses that are replies to an existing status
favourites_per_account = 50  # favourites each account hands out
bookmarks_per_account = 10
with_notifications = false   # generate follow/favourite notifications (expensive)
seed = 1337                  # RNG seed for reproducible cohorts; null = random
chunk_size = 5000            # rows per bulk-insert batch
```

All keys are optional and default to a **small, safe profile** (see `SampleDataConfig`
defaults below) so that hitting the UI button on a fresh install does something quick
and visible rather than locking up.

### Named size presets

For convenience the CLI exposes presets that scale the whole shape together, so a user
doesn't have to hand-tune six numbers to "make it bigger":

| preset | accounts | followers/acct | statuses/acct | ≈ total status rows |
|----------|---------:|---------------:|--------------:|--------------------:|
| `tiny` | 10 | 5 | 10 | 100 |
| `small` | 100 | 20 | 50 | 5,000 |
| `medium` | 1,000 | 100 | 100 | 100,000 |
| `large` | 5,000 | 1,000 | 1,000 | 5,000,000 |
| `huge` | 10,000 | 1,000 | 1,000 | 10,000,000 |

`large`/`huge` are the "find the failure point" sizes and are expected to be slow and
possibly to exhaust memory on `:memory:` DBs — that's the point. The CLI prints a
warning and a rough row estimate before running anything above `medium`.

## Public API

### `SampleDataConfig` (config.py)

```python
class SampleDataConfig(BaseModel):
    accounts: int = 100
    followers_per_account: int = 20
    statuses_per_account: int = 50
    reply_ratio: float = 0.2
    favourites_per_account: int = 10
    bookmarks_per_account: int = 0
    with_notifications: bool = False
    seed: int | None = None
    chunk_size: int = 5000
```

Added to `MastodonMockConfig` as `sample_data: SampleDataConfig`.

`PRESETS: dict[str, SampleDataConfig]` holds the named presets above.

### `generate_sample_data(engine, config) -> GenerationReport` (db/sample_data.py)

The core generator. Phases, each timed:

1. **accounts** — bulk-insert N account rows (synthetic username `user_{n}_{rand}`,
   token rows for the first `min(N, token_cap)` accounts so they're loginable).
1. **follows** — for each account pick `followers_per_account` random distinct targets;
   bulk-insert directed `relationships` rows with `following=True` (+ mirror
   `followed_by`). No locked-account logic (sample accounts are unlocked).
1. **statuses** — bulk-insert `statuses_per_account` rows per account; a `reply_ratio`
   fraction get `in_reply_to_id` pointing at a previously-generated status.
1. **engagement** — bulk-insert favourites/bookmarks; optionally notifications.

Returns a `GenerationReport` (per-phase row counts + durations + total) so the CLI/UI
and the benchmark harness can print/assert against it.

```python
@dataclass
class GenerationReport:
    accounts: int
    relationships: int
    statuses: int
    favourites: int
    bookmarks: int
    notifications: int
    phase_seconds: dict[str, float]
    total_seconds: float
    rows_per_second: float
```

### SQLite bulk-load tuning

`db/sample_data.py` applies, for the duration of the load only:

```sql
PRAGMA synchronous = OFF;
PRAGMA journal_mode = MEMORY;   -- file DBs: WAL
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;     -- ~64MB page cache
```

restoring previous values in a `finally`. These are safe because the mock is a
throwaway test target (durability is irrelevant).

## CLI

```bash
mastodon_mock gen-data [--preset medium]
                       [--accounts N] [--statuses-per-account N]
                       [--followers-per-account N] [--config PATH]
                       [--database PATH | --in-memory]
                       [--seed N] [--yes] [--json]
```

- With no flags, uses `[tool.mastodon_mock.sample_data]` (or the small default).
- `--preset` selects a named preset; individual `--*` flags override fields on top of
  the preset/config.
- Writes into the **configured database** (defaults to the config's `path`; refuses to
  run against `:memory:` unless `--in-memory`, since an in-memory DB created by the CLI
  process vanishes when it exits — only useful with `gen-data` immediately feeding a
  benchmark in the same process).
- Prints the `GenerationReport` as a table, or `--json` for machine consumption (used by
  the benchmark harness / CI baseline check).
- `--yes` skips the "this will create ~N rows, continue?" confirmation for large shapes.

Implemented as a new `gen-data` subparser in `cli.py` plus a `_gen_data(args)` handler.

## Angular UI: "Seed sample data" button

A mock-only control on the **login** screen's Dev panel (next to "+ Regular/Admin
user"), since that's where dev/seed affordances already live and it's reachable before
you have a token.

- Button: **"Seed sample data"** → calls `POST /api/v1/_mock/sample_data` with an empty
  body (server uses the configured/default `sample_data` profile).
- While running, the button shows a spinner/disabled state; on completion it shows a
  toast/line: *"Created 100 accounts, 5,000 statuses in 0.8s"* from the returned report,
  then refreshes the dev-user list so the new loginable accounts appear.
- A small `<select>` lets the tester pick a preset (`tiny`/`small`/`medium`) — `large`/
  `huge` are intentionally **not** offered from the browser (they can wedge the single
  shared connection; those are CLI-only).

### New endpoint

```
POST /api/v1/_mock/sample_data
body: { "preset": "small" } | { "accounts": 50, "statuses_per_account": 20, ... } | {}
-> 200 { "report": GenerationReport-as-json }
```

Mock-only (lives in `routers/oauth.py` alongside the other `/_mock/*` dev endpoints).
Builds a `SampleDataConfig` from the body merged over the configured default, then calls
`generate_sample_data(engine, cfg)` and returns the report. Rejects shapes above a
server-side cap (`accounts > 2000` or estimated rows > ~750k) with `422` so a browser
can't accidentally request a `large`/`huge` cohort — `medium` (~300k rows) is allowed.

## Performance baselines & regression guard

### Benchmark harness (`tests/perf/`)

`pytest`-based, marked `@pytest.mark.slow` (already a registered marker in
`pyproject.toml`) so it's excluded from the default `-m 'not integration'` run and opt-in
via `pytest -m slow`.

Two benchmark families:

1. **Generation throughput** — `generate_sample_data` over `tiny/small/medium`,
   asserting `rows_per_second` stays above a floor and total time under a ceiling. These
   ceilings are the regression guard: a 2–3× slowdown fails the test.

1. **Read-path latency under load** — generate a `medium` cohort once (module-scoped
   fixture), then time representative endpoints against it via `httpx.ASGITransport`:

   - `timeline_home` (worst case: join across follows + statuses + counts)
   - `account_statuses` for a heavy account
   - `notifications`
   - `status` detail (with its derived counts)

   Assert P50/P95 latency under documented ceilings.

### Baselines file

A committed `tests/perf/baselines.json` records the reference numbers (machine-relative,
so generous tolerances — the guard is for *order-of-magnitude* regressions, not ±10%
noise). A helper `pytest --update-perf-baselines` (or a make target) regenerates it.

```json
{
  "machine_note": "baselines are advisory; CI asserts ratios not absolutes",
  "generate": { "medium": { "rows_per_second_min": 50000 } },
  "read": {
    "timeline_home_p95_ms": 150,
    "account_statuses_p95_ms": 120,
    "notifications_p95_ms": 100
  }
}
```

### make targets

```
make perf            # pytest -m slow  (run the benchmark suite)
make perf-baseline   # regenerate tests/perf/baselines.json
make gen-data-medium # mastodon_mock gen-data --preset medium --database ./perf.db --yes
```

## Phased implementation plan

**Phase 1 — generator core + config + CLI (no UI).** ✅ start here.

- `SampleDataConfig` + `PRESETS` in `config.py`; wire into `MastodonMockConfig`.
- `db/sample_data.py`: `generate_sample_data`, `GenerationReport`, PRAGMA tuning, bulk
  inserts for accounts/tokens/follows/statuses.
- `gen-data` CLI subcommand with `--preset`, overrides, `--json`, `--yes`.
- Unit tests: `tiny`/`small` generate the expected row counts; generated accounts are
  loginable; FKs are valid (no orphan statuses/edges).

**Phase 2 — engagement + mock endpoint + UI button.**

- Favourites/bookmarks/notifications phases.
- `POST /api/v1/_mock/sample_data` with server-side cap.
- Angular: preset `<select>` + "Seed sample data" button on the login Dev panel; report
  toast; refresh dev users. `api.ts` method + `GenerationReport` model.

**Phase 3 — benchmark harness + baselines.**

- `tests/perf/` generation-throughput + read-latency benchmarks under `-m slow`.
- `tests/perf/baselines.json` + ratio-based regression asserts.
- `make perf` / `make perf-baseline` targets; document running them in this file.

**Phase 4 — find & fix failure points (iterative).**

- Run `large`/`huge` from the CLI; capture where it breaks (memory on `:memory:`, slow
  timeline joins, missing indexes, serializer N+1s).
- Record findings + applied fixes in a "Findings" section below; turn each fixed
  regression into a baseline assertion so it can't come back.

## Findings (living section)

> Populated as Phase 4 uncovers and fixes ceilings. Each entry: symptom, root cause,
> fix, and the baseline/assert that now guards it.

### F1 — `timeline_home`/`timeline_public` serializer N+1 (resolved)

- **Symptom:** under a `medium` cohort (1k accounts x 100 statuses, 100k status rows),
  a 20-item `GET /api/v1/timelines/home` ran ~237ms median / ~379ms P95 over loopback;
  `timeline_public` ~224ms median. The DB query that selects the 20 status rows is
  cheap and indexed; the time was all in serialization.
- **Root cause:** `serializers/statuses.py::serialize_status` issued a separate query
  per status for `reblogs_count`, `favourites_count`, `replies_count`, `favourited`,
  `bookmarked`, `muted`, `pinned`, `reblogged`, mentions, tags, and media — and then
  called `serialize_account`, which itself counts followers/following/statuses. That's
  ~13+ round-trips x 20 statuses ≈ 260 queries per timeline request. Classic N+1.
- **Fix:** new `serializers/batch.py::build_status_context` computes every per-status
  and per-author aggregate for a whole page in a small **constant** number of grouped
  queries (`COUNT(...) GROUP BY status_id` per engagement table; `IN (...)` fetches for
  viewer flags, mentions, tags, media; grouped follower/following/status counts per
  author). `serialize_status`/`serialize_account` gained an optional `ctx` param: when
  present they read from the precomputed `BatchContext`, otherwise they keep the old
  single-row query path (so single-status endpoints are unchanged). A new
  `serialize_status_list(...)` builds the context once and is now used by every
  list-of-statuses endpoint (home/public/tag/list timelines, `account_statuses`,
  favourites, bookmarks, search, thread context, bulk-by-id, trends). ~260 queries → a
  handful.
- **Result (same harness, medium cohort, loopback):** `timeline_home` 237ms → **56ms
  median** (~4.2x); `timeline_public` 224ms → **34ms** (~6.6x); `account_statuses`
  ~300ms P95 → **34ms median / 40ms P95** (~9x). All 243 contract tests still pass,
  confirming byte-identical serialized output.
- **Guard:** baseline ceilings in `tests/perf/baselines.json` tightened to
  `timeline_home_p95_ms = 150`, `account_statuses_p95_ms = 120` (down from 600), so a
  regression back toward the N+1 now fails `tests/perf/test_perf_read_latency.py`.

### F2 — nested reblog/quote serializer N+1 + per-page account memo (resolved)

- **Symptom:** F1 batched the *page body* but each row's reblog/quote **target** still
  went through the single-row query path. A 20-item `timeline_home` page made entirely of
  reblogs (real home timelines are reblog-heavy) issued ~320 queries — the N+1 was simply
  pushed down one level. The existing perf read-latency benchmark never caught this
  because `db/sample_data.py` generates **no reblogs**, so the medium cohort's home
  timeline has none.
- **Root cause:** `serialize_status` recursed into the reblog/quote target with
  `ctx=None`, so the nested status re-queried its own counts/flags/mentions/tags/media and
  its author's follower/following/status aggregates (~16 queries × 20 rows). Separately,
  `serialize_account` rebuilt an identical dict for every occurrence of a recurring author
  (all 20 rows of an `account_statuses` page share one author).
- **Fix:** `serialize_status_list` now collects each page row's `reblog_of_id`/
  `quoted_status_id` targets, fetches them in one `IN (...)` query, and folds them into the
  **same** `build_status_context` call (so their own status-level aggregates *and* their
  authors' account aggregates are batched). The nested `serialize_status` calls now receive
  that `ctx`. `BatchContext` also gained an `account_json` memo: `serialize_account` caches
  its finished dict per `account.id` (base shape only; the `with_source` variant is
  request-specific and never listed), so a recurring author is serialized once per page.
- **Result:** a 20-reblog page went from **320 → 16 queries** (~20×), byte-identical
  output (every nested reblog payload still present). The account memo is CPU/allocation
  only — F1 already eliminated its queries — but removes 19 redundant dict builds on a
  single-author `account_statuses` page.
- **Guard (recommended, not yet wired):** the perf suite can't see this until the sample
  generator emits reblogs. Suggest adding a `reblog_ratio` to `SampleDataConfig` and a
  `timeline_home`-with-reblogs latency assertion so F2 can't silently regress.
