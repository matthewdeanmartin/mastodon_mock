# mastodon_mock — Specification

This directory specifies a **stateful, local Mastodon API mock** for exercising
[Mastodon.py](https://github.com/halcy/Mastodon.py) clients in tests, with a focus on
**write paths** (post, follow, favourite, etc.) being reflected in subsequent reads —
something static mocks (Mockoon, recorded fixtures) cannot do.

Read [00-overview.md](00-overview.md) first for goals/non-goals, then the rest in order:

1. [00-overview.md](00-overview.md) — purpose, goals, non-goals, document map
1. [01-architecture.md](01-architecture.md) — FastAPI/SQLAlchemy/Alembic/SQLite,
   package layout, config file format
1. [02-data-model.md](02-data-model.md) — database schema
1. [03-api-coverage.md](03-api-coverage.md) — endpoint-by-endpoint coverage matrix
   (Full / Static / Stub / Out-of-scope), keyed to Mastodon.py call sites
1. [04-auth.md](04-auth.md) — fake OAuth, multi-account bearer tokens
1. [05-versioning.md](05-versioning.md) — "current and current-1" Mastodon version
   awareness
1. [06-testing.md](06-testing.md) — testing this mock, and using it for a dual
   mock/real test suite in a consuming project
1. [07-seeding-and-fixtures.md](07-seeding-and-fixtures.md) — seed config for
   multi-account scenarios
1. [08-admin-ui.md](08-admin-ui.md) — **roadmap** for the dogfooding Angular admin
   panel / client UI served at `/_ui/`
1. [09-sample-data-and-perf.md](09-sample-data-and-perf.md) — high-performance bulk
   sample-data generator (CLI `gen-data` + `/_mock/sample_data` + UI button) and the
   performance baseline / regression-guard harness
1. [streaming.md](streaming.md) — Server-Sent-Events streaming API (`stream_user` /
   `stream_public` / `stream_hashtag` / `stream_list` / `stream_direct`), event routing,
   and the streaming-base-URL rewrite
1. [fault_injection.md](fault_injection.md) — mock-only fault-injection control plane
   (`/_mock/faults`) for forcing errors, latency, malformed bodies, and timeouts

## TL;DR for implementers

- Build order roughly follows the doc numbering: get the FastAPI app + SQLite
  (in-memory) + Alembic skeleton up (01, 02), then auth (04), then instance/version
  endpoints (05), then accounts + statuses + timelines (the "Full" rows in 03, which
  are the highest-value/highest-risk endpoints per the user's original ask), then fill
  in the remaining routers from 03 roughly in priority order (relationships → media →
  notifications → everything else).
- Every "Full" row in [03-api-coverage.md](03-api-coverage.md) should get at least one
  Mastodon.py-driven contract test per [06-testing.md](06-testing.md) layer 3.
- `spec/` is documentation, not code — once implementation starts, keep this directory
  in sync with reality (update coverage table entries from Stub→Full as they're
  implemented; that table doubles as a progress tracker).
