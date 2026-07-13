# Roadmap: mastodon_mock — remaining gaps and opportunities

> Audience: **implementation bots/agents.** Each work item below is written as an
> instruction with acceptance criteria and a verification command. Do the sprints in
> order; within a sprint, items are ordered by value. Read this whole file before
> starting any item.
>
> Audit date: 2026-07-12. Sources: code review of `mastodon_mock/` and `tests/`,
> `spec/last_last_mile.md` (Phases 0–2 complete; this roadmap subsumes its Phases 3–5),
> `spec/openapi_compare_report.md`, the three `spec/findings_from_*.md` dogfooding
> reports, `coverage.xml`, and `tests/perf/baselines.json`.

## Mission (do not lose sight of this)

`mastodon_mock` exists so developers building Mastodon-centric apps can test against a
**real, stateful, local HTTP server** instead of spinning up a Mastodon cluster or
polluting mastodon.social. Every item below serves one of four pillars:

1. **DX** — best-in-class experience for Python developers (pytest-first, zero
   boilerplate, moto-grade ergonomics).
2. **Fidelity** — responses and error shapes a real Mastodon 4.6 would produce, so
   tests that pass here pass against production.
3. **Performance** — fast enough that nobody hesitates to run the suite on every save.
4. **Coverage** — of the mock's own code (measured) and of the Mastodon API surface
   (honest, classified per `spec/03-api-coverage.md`).

## Ground rules for implementing bots

- Python project managed with `uv`. Run everything via `uv run` (`uv run pytest`,
  `uv run mastodon_mock ...`). Never the system interpreter.
- Contract tests are marked `contract` and deselected by default
  (`uv sync --extra contract && uv run pytest -m contract` to run them).
- The compatibility target is Mastodon **4.6.0 / API v10** (current) and **4.5.7**
  (current-1). Truth schema lives in `mastodon-openapi/`.
- A route that returns a fixed/empty body is **not** coverage. Every new or changed
  endpoint must be classified Stateful / Derived / Static / No-op / OOS in
  `spec/03-api-coverage.md` and proven by a contract test that shows a **write
  changing a subsequent read** (where applicable).
- Preserve the deliberately-permissive testing ergonomics by default; put strictness
  behind opt-in config switches (the `faults.py` / strict-scopes pattern).
- Regenerate `spec/openapi_compare_report.md` via `make compare-openapi` after any
  routing change; it must stay at 0 truth-only operations.
- Do not build fake subsystems (job queues, crawlers, federation). Derive from
  existing rows or return documented deterministic fakes.

## Current state (verified 2026-07-12 — do not redo this work)

- **Operation parity**: 210 shared operations, 0 truth-only, 0 required-param
  mismatches. Every 4.6 path/method is routed.
- **Stateful core**: statuses, timelines, follows, favourites/bookmarks, lists,
  filters (applied, with `Status.filtered`), notifications + policy + requests,
  quote approval, scheduled statuses, polls, conversations, search, admin
  moderation with observable consequences.
- **DX shipped**: pytest11 auto-registered plugin (`mastodon_mock_server`,
  `mastodon_mock_session`, `mastodon_mock_reset`, `mastodon_mock_client`, marker,
  `mastodon_mock_config` override), context manager, decorator sugar, CLI
  (`serve`, `gen-data`, `compare-openapi`), fault injection (`/_mock/faults`),
  SSE + legacy WebSocket streaming, bundled web/admin UI, demo seed, HTTPS docs.
- **Perf**: bulk generator (20–30k rows/s baselines), p95 read-latency regression
  guards in `tests/perf/`.
- **Coverage**: 82.7% line coverage (6558 valid lines); **branch coverage is not
  enabled** (branch-rate=0 with 0 branches valid = not measured).
- **Known-red**: strict Schemathesis fuzzing fails on error-envelope shape,
  validation-body shape, and missing required v1 instance fields.

---

# General roadmap

| Theme | Gap | Sprint |
| --- | --- | --- |
| Fidelity | FastAPI `{"detail": ...}` error envelope instead of Mastodon `{"error": ...}`; 422 body shape; missing required instance fields; strict fuzz red | 1 |
| Coverage | 82.7% lines, no branch measurement, no ratchet in CI | 1 |
| DX | No in-process (ASGI) mode — every test pays uvicorn+socket cost; xdist story unverified; no time control; no scenario factories | 2 |
| Performance | Threaded uvicorn per function-scoped fixture; no published "suite of 100 tests costs X" number | 2 |
| Fidelity | Cheap derived surfaces still empty: link trends/timeline, oEmbed, admin measures/dimensions | 2 |
| Fidelity | Streaming misses `filters_changed`, announcement events; push has no recorded deliveries | 3 |
| API surface | Collections (4.6) shape-only; identity proofs empty; strict scope/role enforcement coarse | 3 |
| DX | Docs: no "testing cookbook", no CI recipe page, examples not surfaced as a gallery | 3 |

Non-goals (unchanged, do not implement): federation, real WebPush crypto delivery,
browser-grade OAuth, a real job system, time-windowed trend analytics engines.

---

# Sprint 1 — Fidelity: Mastodon-shaped errors and honest schemas; coverage ratchet

**Sprint goal:** strict GET fuzzing goes green (with a reviewed exception list), and
CI enforces a coverage floor. This is `last_last_mile.md` Phase 3.

### 1.1 Mastodon-shaped error envelope (highest value in the whole roadmap)

Real Mastodon returns `{"error": "..."}` (sometimes with `error_description`); the
mock leaks FastAPI's `{"detail": ...}` from every `HTTPException` and un-handled
error. Client libraries branch on the `error` key, so consumers currently cannot
test their error handling — the single biggest fidelity hole.

- Add exception handlers in `mastodon_mock/app.py` for `HTTPException` and
  `RequestValidationError` that emit Mastodon-shaped bodies:
  - `HTTPException` → `{"error": <detail string>}` with the same status code.
  - Validation errors → `422` with `{"error": "Validation failed: <human summary>"}`
    (match the shape documented in `findings_from_activist.md` and already used by
    `routers/statuses.py` manual validation — reuse, don't duplicate).
- Sweep routers for handlers that construct error bodies by hand; route them through
  one helper (put it in `routers/helpers.py`).
- Rate-limit and auth failures (401/403/404/429) must all use the envelope.
- **Accept:** a new `tests/test_error_envelope.py` asserts the envelope for at least:
  bad token (401), missing status (404), over-long status (422), unknown route (404),
  fault-injected 500, rate-limited 429. Mastodon.py raises its typed exceptions
  (`MastodonNotFoundError` etc.) for each — assert that too, since that is what
  consumers actually experience.
- **Verify:** `uv run pytest tests/test_error_envelope.py tests -x -q`.

### 1.2 Fill required instance/entity fields found by strict validation

- Run strict Schemathesis (see `pyproject.toml` contract extra) and collect the
  missing-required-field failures, starting with `configuration.accounts` on
  v1 instance.
- Fix the serializers (`serializers/instance.py` first), not the schema.
- **Accept:** strict one-example GET fuzz no longer reports missing-required-field
  failures for instance, account, or status entities.
- **Verify:** `uv sync --extra contract && uv run pytest -m contract -q`.

### 1.3 Strict-fuzz ratchet

- Make strict GET fuzzing a CI-runnable ratchet: a reviewed `QUARANTINE`/allowlist
  (in `tests/openapi/allowlist.py`, alongside the existing `MOCK_ONLY` list) of
  known-red operations, failing the build on **new** entries.
- Record each quarantined operation with a one-line reason and the sprint item that
  will fix it.
- **Accept:** `uv run pytest -m contract` is green with the quarantine list; removing
  an entry for a fixed operation keeps it green; the list shrinks in this sprint,
  never grows without review.

### 1.4 Response models for core entities (bounded — do not gold-plate)

- Add response models (or explicit OpenAPI component mappings) for the five
  highest-traffic entities only: Status, Account, Notification, Relationship,
  Instance. The mock's own `/openapi.json` should say something true about them.
- Do **not** convert every handler; untyped `dict` returns on admin/misc routes are
  acceptable this sprint.
- **Verify:** `uv run mastodon_mock compare-openapi --format text` still reports 0
  truth-only and 0 required-param mismatches.

### 1.5 Coverage: measure branches, ratchet the floor

- Enable branch coverage in the coverage config (`pyproject.toml`/`tox.ini`, wherever
  `[tool.coverage.run]` lives) — `branch = true`.
- Add `fail_under` at the currently-achieved value rounded down (start at 82 for
  lines; after enabling branches, re-baseline and set the combined floor to whatever
  is actually achieved, minus 1).
- Identify the 5 worst-covered modules (`uv run coverage report --sort=cover`) and
  write targeted unit tests for the top 3. Expected suspects based on module review:
  `cli.py` error paths, `openapi_compare.py`, `streaming.py` teardown paths,
  `faults.py` combinations, `config.py` validation branches.
- **Accept:** CI fails if coverage drops below the floor; floor is raised in every
  future sprint that adds tests.
- **Verify:** `uv run pytest -q` then `uv run coverage report`.

---

# Sprint 2 — DX & performance: in-process mode, parallel-safe fixtures, scenario tooling

**Sprint goal:** the pytest experience is best-in-class (moto-tier), and a consumer's
100-test suite runs measurably faster. This also covers `last_last_mile.md` Phase 4's
cheap derived surfaces.

### 2.1 In-process ASGI mode (flagship performance/DX item)

Today `MockServer` always boots threaded uvicorn on a real socket
(`testing/server.py`). That is correct for clients that need real HTTP (Mastodon.py
does), but many tests only need an HTTP-shaped transport. Offer both:

- Add an in-process mode using `httpx.ASGITransport` against `create_app(config)`:
  no socket, no thread, no readiness poll. Expose it as:
  - `MockServer(mode="asgi")` (default stays `"http"`), and
  - a `mastodon_mock_app` pytest fixture yielding a started app + an `httpx.Client`
    wired to it.
- Document the trade-off prominently: Mastodon.py and other real clients require
  `mode="http"`; raw-httpx/requests-free test code can use `"asgi"`.
- Investigate whether Mastodon.py's session can be adapted (it uses `requests`;
  if a shim is more than ~50 lines, don't — document instead).
- **Accept:** an ASGI-mode test posting a status and reading it back passes with no
  port bound (assert no listening socket). Benchmark note added to
  `spec/09-sample-data-and-perf.md` comparing per-test overhead of the three
  patterns: function-scoped http server, session+reset, asgi.
- **Verify:** `uv run pytest tests/mock_only/test_fast_server.py -q` (extend that
  file).

### 2.2 pytest-xdist safety (verify, fix, document, test)

- Free-port allocation already exists, but session-scoped fixtures under `-n` mean
  one server **per worker** — verify nothing collides (SQLite in-memory is
  per-process, so it shouldn't; file-backed DBs will).
- Guard: if a consumer points two workers at one SQLite file, fail fast with a clear
  error instead of corrupting.
- **Accept:** `uv run pytest tests -n 4 -q` (add `pytest-xdist` to the dev extra)
  passes; a docs section "Running in parallel" exists.

### 2.3 Time control

Trends, scheduled statuses, announcement windows, and `last_status_at` all depend on
wall-clock time; consumers cannot test them deterministically.

- Introduce a single clock seam (a `now()` provider on the app/config) and a
  mock-only control endpoint `POST /_mock/time` (set/advance frozen time), plus
  `MockServer.set_time()`/`advance_time()` sugar.
- Scheduled statuses must publish when the frozen clock passes `scheduled_at` (check
  on read is fine — no background job).
- **Accept:** a contract test schedules a status 1h out, advances the mock clock,
  and reads it on the home timeline.

### 2.4 Scenario builders (seed sugar)

`gen-data` presets and `SeedConfig` exist, but building a specific scenario in a test
("alice follows bob, bob posted 3 statuses, one with media") is still manual.

- Add a fluent builder in `mastodon_mock/testing/` (e.g. `Scenario().account("alice")
  .follows("bob"); bob.post(...)`) that compiles to a `SeedConfig`, usable in the
  `@pytest.mark.mastodon_mock(seed=...)` marker.
- Keep it thin — it produces seed config, it does not talk to the server.
- **Accept:** README and `spec/07-seeding-and-fixtures.md` show the builder; at
  least one existing verbose test is rewritten with it.

### 2.5 Cheap derived surfaces (close the "shape-only" empties)

Per `last_last_mile.md` Phase 4 — derive, don't build subsystems:

- Link timeline + link trends from URL-bearing local statuses and their existing
  deterministic preview cards.
- oEmbed resolves known local status URLs and emits author/status-derived fields.
- A documented subset of admin measures/dimensions from real DB counts and date
  buckets (works well with 2.3's frozen clock); the rest stay zero and documented.
- Retention stays static. ToS revisions stay static.
- **Accept:** each gets a contract test proving derivation from seeded state;
  `spec/03-api-coverage.md` reclassifies them Static → Derived.

### 2.6 Perf baselines for the new modes

- Extend `tests/perf/baselines.json` + `make perf-baseline` with: server cold-start
  ms (http mode), reset() ms, asgi-mode request p95.
- **Accept:** perf tests guard order-of-magnitude regressions on start-up and reset,
  since those dominate consumer suite time.

---

# Sprint 3 — Round out the surface: streaming/push depth, 4.6 families, strictness opt-ins, docs

**Sprint goal:** the remaining second-tier gaps are either implemented or explicitly,
discoverably documented as fakes. This covers `last_last_mile.md` Phase 5.

### 3.1 Streaming event completeness

- Emit `filters_changed` on filter CRUD and `announcement` /
  `announcement.reaction` / `announcement.delete` events (wire into
  `streaming_events.py`).
- Audit remaining Mastodon event types against the 4.6 docs; implement the ones the
  mock already has state for; list the rest in `spec/streaming.md` as OOS with
  reasons.
- **Accept:** `tests/mock_only/test_streaming.py` gains one test per new event
  proving the write → event pipeline.

### 3.2 Push notification *recording* (not delivery)

Real WebPush crypto stays a non-goal, but consumers testing notification logic need
observability:

- Persist client `p256dh`/`auth` keys instead of discarding them; generate a stable
  fake `server_key`.
- Record would-be pushes (subscription + notification type + payload summary) and
  expose them at a mock-only endpoint `GET /_mock/pushes`, honoring the
  subscription's `alerts` filter.
- **Accept:** contract test: subscribe with alerts `{mention: true, follow: false}`,
  trigger both, `/_mock/pushes` contains exactly the mention.

### 3.3 Collections (the one 4.6 stateful family worth building)

- Implement persisted CRUD + membership + grant transitions per the 4.6 schema;
  remove its strict-fuzz quarantine entries.
- Configurable identity proofs via seed config (cheap, optional).
- Annual reports: keep deterministic; generate a small fake report from real counts
  if trivial, else leave static and documented.
- **Accept:** collections classified Stateful in `spec/03-api-coverage.md` with
  write-changes-read contract tests.

### 3.4 Opt-in strict authorization mode

- Extend the existing coarse scope enforcement with an opt-in `strict_scopes` config:
  fine-grained scope checks (e.g. `write:statuses` vs `write`) and admin-role
  enforcement on `/api/v1/admin/*`, returning enveloped 403s (Sprint 1.1).
- Default stays permissive; this exists so consumers can test their app's
  authorization-failure handling.
- **Accept:** `tests/mock_only/test_scope_and_ratelimit.py` extended: same request
  passes by default, 403s under strict mode.

### 3.5 Webfinger `resolve` — decide and document

`findings_from_mastodon_finder.md` flagged `search?resolve=true` as local-only. Do
**not** implement network webfinger. Instead:

- Add seedable "resolvable remote accounts": seed config may declare remote handles
  (`@user@remote.example`) that `resolve=true` materializes as remote-domain accounts.
  This keeps determinism and lets discovery tools test their resolve path.
- **Accept:** contract test resolves a seeded remote handle; unseeded handles still
  return empty; documented in `spec/07-seeding-and-fixtures.md`.

### 3.6 Documentation: the testing cookbook

The features now exceed the docs. Add to `docs/` (mkdocs):

- **Cookbook page**: recipes for the 10 most common consumer tasks — test a bot's
  posting path, test pagination handling, test rate-limit/error handling (faults),
  test streaming consumption, test with frozen time, parallel CI, choosing
  function/session/asgi fixture modes, scenario builder, multi-account
  conversations, admin/moderation flows.
- **CI recipe**: a copy-pasteable GitHub Actions job for a consumer project.
- **Fidelity statement**: one page that says exactly what is Stateful / Derived /
  Static / No-op / OOS (generated from or linked to `spec/03-api-coverage.md`) so
  users never mistake a fake for the real thing.
- **Accept:** `uv run mkdocs build --strict` passes; README links the cookbook.

### 3.7 Coverage floor raise (recurring)

- Re-run the Sprint 1.5 worst-module analysis; add tests; raise `fail_under` by at
  least 2 points from the Sprint 1 floor. Target trajectory: ≥90% lines with
  branches measured by end of Sprint 3.

---

# Definition of done, per sprint (bots: self-check before closing)

1. `uv run pytest -q` green; `uv run pytest -m contract -q` green (with reviewed
   quarantine only); `-n 4` green from Sprint 2 on.
2. `make compare-openapi` regenerated; 0 truth-only operations.
3. Coverage ≥ floor; floor raised whenever the sprint added tests.
4. Perf tests green against `tests/perf/baselines.json`.
5. `spec/03-api-coverage.md` classifications updated for every touched endpoint.
6. CHANGELOG.md entry written; docs updated for any user-visible change.
