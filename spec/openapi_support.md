# OpenAPI Support — Spec & Contract Comparison

Status: **Phases 1, 2, 3 & 5 implemented** (see checkboxes). The operation backlog is
now empty, so Phase 4 (response-shape conformance) is the active remaining roadmap item.
Operation parity must not be read as behavioral parity: several routed 4.6 families are
still static/no-op fakes. See `../last_last_mile.md`.

## Motivation

Two independent descriptions of "the Mastodon API" exist in this repo:

1. **Ground truth** — `mastodon-openapi/dist/schema.json`: an OpenAPI 3.1.0 document
   (`Mastodon API 4.6.0`, ~174 paths, ~135 schemas) generated from the upstream
   [Mastodon documentation](https://github.com/mastodon/documentation) by the vendored
   [`mastodon-openapi`](../mastodon-openapi) tool.
2. **Our implementation** — `mastodon_mock` is a FastAPI app, so it *already* publishes
   an OpenAPI 3.1.0 document of what it actually serves at `/openapi.json`
   (plus Swagger UI at `/docs` and ReDoc at `/redoc`). Today nothing surfaces this in
   the Angular admin UI, and nothing checks it against the ground truth.

Because both sides are OpenAPI 3.1.0, we can:

- **Surface** the mock's own contract in the UI (was already served, just hidden).
- **Compare** the two contracts to find drift — endpoints we claim to implement that
  the real API doesn't have, real endpoints we're missing, parameter/method mismatches,
  and (later) response-shape divergence.
- **Fuzz** the running mock against the ground-truth schema with an OpenAPI-driven
  property test tool ([`schemathesis`](https://schemathesis.readthedocs.io/)), throwing
  generated inputs at every endpoint and asserting responses conform.

This doc is the plan. It is split into phases; the early phases are cheap, deterministic,
and high-signal (pure spec-vs-spec diffing); the later phases bring in a live server and
generated traffic.

## Background findings (reconnaissance)

A normalized path comparison (path params collapsed to `{}`) originally found:

| metric                         | count |
|--------------------------------|-------|
| ground-truth operations        | ~210  |
| mock operations                | ~264  |
| in both                        | ~176  |
| **mock-only**                  | ~88   |
| **truth-only (unimplemented)** | ~34   |

- **mock-only** operations are overwhelmingly intentional: the `/_mock/*` control plane
  (login, reset, faults, sample data), `/_ui`, `/.well-known/*`, the root `/`, and the
  `/api/v1/admin/*` surface. These should be *allow-listed* so they don't show up as
  "drift". A handful may be genuine accidental extras worth flagging.
- **truth-only** operations are genuinely-unimplemented real endpoints (e.g.
  `/api/oembed`, `/api/v1/annual_reports`, `/api/v1/collections/*`,
  `DELETE /api/v1/push/subscription`). This list *is* a coverage backlog and should be
  reconcilable against `spec/03-api-coverage.md`.

Current result (2026-06-20): **210 shared operations, 0 truth-only operations, and
0 required-parameter mismatches**. Some former truth-only operations were closed with
static or no-op handlers, so the behavior backlog is tracked separately in
`../last_last_mile.md`.

Known structural mismatches that a naive comparison must handle:

- **Path-template naming.** Mock uses descriptive params (`/api/v1/accounts/{account_id}`)
  where the truth uses `{id}`. Comparison MUST normalize param *names* away and compare
  on structure/position, not literal templates.
- **No `response_model`.** Mock route handlers return bare `dict`/`list[dict]`, so the
  mock's generated OpenAPI has near-empty response schemas. Response-shape comparison is
  therefore only meaningful **mock-runtime-output → truth-schema**, not
  **mock-schema → truth-schema**. (Phase 4.)

## Phase 1 — Surface the OpenAPI interface (UI + report tooling) ✅

Goal: make both contracts discoverable and produce a deterministic, committed-to-disk
comparison report. No live server, no generated traffic — pure file/spec work.

- [x] **1a. Comparison library** `mastodon_mock/openapi_compare.py`:
    - `load_spec(path) -> dict` (utf-8 safe).
    - `normalize_path(path) -> str` collapsing `{param}` → `{}`.
    - `operation_set(spec) -> set[(method, normalized_path)]`.
    - `compare_specs(truth, mock, *, ignore) -> ComparisonReport` with:
      `common`, `mock_only` (minus ignore-list), `truth_only`, plus per-shared-operation
      parameter diffs (required query/path params present in truth but missing in mock,
      and vice-versa).
    - A default **ignore-list** of mock-only prefixes (`/_ui`, `/api/v1/_mock`,
      `/.well-known`, `/`, `/media`, `/avatars`, `/headers`, `/docs`, `/redoc`,
      `/openapi.json`) and the admin surface, expressed as prefix globs.
- [x] **1b. CLI** `mastodon_mock compare-openapi` (added to `cli.py`):
    - `--truth PATH` (default `mastodon-openapi/dist/schema.json`),
    - `--mock PATH` (default: generate from the live app in-process),
    - `--format text|json|markdown`, `--out PATH`,
    - exit non-zero when *unexpected* drift is found (gated by `--strict`).
- [x] **1c. Self-spec endpoint already exists** (`/openapi.json`); add a `/_ui`-linked
  **"API Docs"** nav entry pointing at `/docs` so the Swagger UI is discoverable from the
  admin panel. (UI: add to the "More" menu.)
- [x] **1d. Committed report**: `make compare-openapi` writes
  `spec/openapi_compare_report.md` so drift is reviewable in PRs.

## Phase 2 — Spec-vs-spec contract test in the suite ✅

Goal: turn the comparison into a guard rail that runs in CI, with an explicit, reviewed
allow-list so intended divergence doesn't fail the build but *new* divergence does.

- [x] **2a. Allow-list fixture** `tests/openapi/allowlist.toml` (or `.py`): the curated
  set of expected `mock_only` operations (control plane, admin, UI, well-known) and
  expected `truth_only` operations (the known coverage backlog), each with a short reason.
- [x] **2b. Tests** `tests/test_openapi_contract.py`:
    - both specs are valid OpenAPI 3.1.0 and parse;
    - every mock-only operation is covered by the allow-list (fails on a *new* extra);
    - every truth-only operation is covered by the backlog allow-list (fails when we add a
      new endpoint without recording it, AND lets us delete entries as we implement them —
      an xfail-style coverage ratchet);
    - shared operations agree on required path params (after name-normalization).
- [x] **2c. Coverage ratchet**: a test asserting the backlog size is `<=` a recorded
  number, so the unimplemented-endpoint count can only go down. (Documented; the
  allow-list *is* the ratchet — removing an entry as you implement it is the mechanism.)

## Phase 3 — Live fuzzing with Schemathesis ✅

Goal: throw generated, schema-valid (and schema-invalid) requests at a *running* mock and
assert the responses conform to the ground-truth schema.

- [x] Add `schemathesis` to an optional `[contract]` extra (kept out of `test` so the
  default suite stays light; tests marked `contract`, deselected by default).
- [x] A pytest module (`tests/test_openapi_fuzz.py`) that boots the mock (reuses
  `mastodon_mock.testing.MockServer`), loads `mastodon-openapi/dist/schema.json`, seeds
  the `alice_token` auth, and runs `schemathesis` against the **shared read-only**
  intersection of operations (filtered via `openapi_compare`). Bounded with a
  `hypothesis` profile so the run is CI-tractable.
- [x] Two modes: **default** asserts only `not_a_server_error` (a guarantee the mock
  should always meet); **`CONTRACT_STRICT=1`** runs the full default check suite
  (`status_code_conformance`, `response_schema_conformance`, `content_type_conformance`).
  Strict mode is the gap-finder and is intentionally *not* a blocking gate yet.
- [x] `QUARANTINE` list (divergent-but-shared ops) and `NOT_FUZZABLE_PREFIXES`
  (streaming/SSE endpoints, which never return a normal body) in the fuzz module.
- [x] **Already paid for itself:** the first default-mode run found two real 500-on-bad-input
  bug classes — non-numeric cursors (`ValueError`) and out-of-range `limit`/`offset`
  (SQLite `OverflowError`) — now fixed via shared `clamp_limit`/`clamp_offset`/`coerce_cursor`
  helpers. The full shared GET surface (87 ops) now passes the "never 500s" guarantee.
- [ ] Stateful testing (Schemathesis links) for the write→read flows the mock exists to
  support (post status → appears in timeline). *Deferred — needs write-path coverage and
  is most valuable once response shapes conform (Phase 4).*

## Phase 4 — Response-shape conformance against truth (roadmap)

Goal: validate the mock's *actual JSON output* against the truth schema's component
schemas (`Status`, `Account`, `Notification`, …), independent of fuzzing.

- [ ] Map each mock endpoint to the truth component it should return.
- [ ] In existing Mastodon.py-driven contract tests, additionally `jsonschema`-validate
  the response body against the resolved truth schema.
- [ ] Optionally backfill `response_model`s on the FastAPI handlers so the mock's *own*
  published OpenAPI becomes richer (and self-documenting in `/docs`).

Strict-mode reconnaissance is currently red. Representative failures include
FastAPI `{"detail": ...}` error bodies instead of Mastodon `{"error": ...}`, default
422 validation shapes, missing required v1 instance configuration fields, and accepting
unknown query parameters that the reconstructed schema rejects.

## Phase 5 — Automation & drift alerting ✅

- [x] CI job (`.github/workflows/openapi-drift.yml`) clones the *untracked* upstream
  `mastodon-openapi` generator, runs `compare-openapi`, enforces the Phase 2 contract
  tests (fails on un-allow-listed drift), and uploads the regenerated report as an
  artifact. Runs on PR/push and weekly (Sunday 10:00 UTC, after upstream's own 08:00
  regeneration).
- [x] When `mastodon-openapi` is re-vendored/updated, the diff in
  `spec/openapi_compare_report.md` (and the uploaded artifact) shows exactly which new
  upstream endpoints appeared — the contract tests fail until they're recorded in the
  allow-list backlog.
- [x] Contributor playbook for all of the above:
  [`docs/extending/openapi-sync.md`](../docs/extending/openapi-sync.md).

## File map

| file                                       | phase | role                           |
|--------------------------------------------|-------|--------------------------------|
| `mastodon_mock/openapi_compare.py`         | 1     | comparison engine              |
| `mastodon_mock/cli.py` (`compare-openapi`) | 1     | CLI entry                      |
| `spec/openapi_compare_report.md`           | 1     | committed report               |
| `tests/openapi/allowlist.py`               | 2     | reviewed divergence allow-list |
| `tests/test_openapi_contract.py`           | 2     | guard-rail tests               |
| `ui/.../shell.html` ("API Docs")           | 1     | UI discoverability             |
| `tests/test_openapi_fuzz.py`               | 3     | Schemathesis live fuzzing      |
| `pyproject.toml` (`contract` extra/marker) | 3     | opt-in fuzzing dependency      |
| `.github/workflows/openapi-drift.yml`      | 5     | automated drift detection      |
| `docs/extending/openapi-sync.md`           | 5     | contributor playbook           |
