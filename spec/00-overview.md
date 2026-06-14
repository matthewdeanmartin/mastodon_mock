# mastodon_mock — Specification Overview

## Purpose

`mastodon_mock` is a **stateful, local HTTP server** that implements enough of the
Mastodon REST API to let a Python client built on [Mastodon.py](https://github.com/halcy/Mastodon.py)
exercise its full read/write surface without a real Mastodon instance.

The driving problem: testing against a real Mastodon server is slow (network round trips,
rate limits) and **risky for writes** (you don't want test runs posting real toots,
following real accounts, etc. on a live instance). Tools like Mockoon return static,
canned responses — fine for read-only smoke tests, but useless once a test does:

```python
me = mastodon.account_verify_credentials()
mastodon.status_post("hello world")
home = mastodon.timeline_home()
assert any(s.content == "<p>hello world</p>" for s in home)
```

A static mock can't reflect the post back. `mastodon_mock` can, because it has a real
(if minimal) database behind it.

## Goals

1. **Stateful**: writes are persisted and visible to subsequent reads, within a single
   server run (and optionally across runs if using a file-backed SQLite DB).
2. **Multi-account**: the mock can hold many accounts simultaneously. A test can create
   account A and account B, have A follow B, post as B, and then read B's post in A's
   home timeline.
3. **Mastodon.py-shaped**: the mock's job is to satisfy Mastodon.py's HTTP calls and
   response parsing — not to be a byte-perfect clone of `mastodon` (the real server).
   If Mastodon.py doesn't call an endpoint or doesn't read a field, we don't need to
   implement/return it.
4. **Two test suites, one assertion set**: the project that consumes this mock should
   be able to run the *same* (or near-same) test bodies against `mastodon_mock` and
   against a real Mastodon instance, and have both pass. `mastodon_mock` is the fast,
   safe default; the real-server suite is opt-in / CI-gated.
5. **Version-aware, narrowly**: Mastodon's API has evolved a lot (see
   [`mastodon/return_types.py`](../Mastodon.py/mastodon/return_types.py) `_version`
   markers and `@api_version(created, last_changed)` decorators). We only need to track
   **current and current-1** major.minor lines (see [05-versioning.md](05-versioning.md)).
   We do not attempt to emulate Mastodon 1.x/2.x/3.x quirks.
6. **Config-driven**: server behavior (DB backend, seed data, version string, etc.) is
   controlled by `.mastodon_mock.toml` or a `[tool.mastodon_mock]` table in
   `pyproject.toml` (see [01-architecture.md](01-architecture.md)).

## Non-goals (explicitly out of scope)

- **No federation / ActivityPub.** We do not implement server-to-server delivery,
  inbox/outbox, signed requests, WebFinger resolution of *remote* accounts, or any
  cross-instance propagation. `mastodon_mock` is a single, closed "instance". Remote
  accounts/statuses can exist as **local rows that merely look remote** (e.g.
  `acct = "bob@otherserver.example"`), seeded directly into the DB — never fetched live.
- **No real security.** OAuth, bearer tokens, and scopes are *modeled* (so Mastodon.py's
  client code paths work and multi-account auth works) but not *enforced* in any way
  that matters outside this mock. Tokens are random strings mapped 1:1 to seeded
  accounts. There is no password hashing, no real client-secret validation, no
  rate-limiting (or only token-bucket theater if a test specifically wants to exercise
  Mastodon.py's `ratelimit_method` handling — TBD, see [03-api-coverage.md](03-api-coverage.md)).
- **No streaming API** (`/api/v1/streaming/*`, websockets) — unless a follow-up phase
  decides Mastodon.py's streaming client is in scope. Not in v1.
- **No admin API** (`mastodon/admin.py`) in v1.
- **No push/WebPush** (`mastodon/push.py`) in v1 — VAPID/webpush crypto is irrelevant to
  the "write and read it back" goal.
- **No media file processing.** Uploaded media is stored (or stubbed) but never
  transcoded/thumbnailed; `media_attachment.url` points to whatever was uploaded (or a
  placeholder) and `MediaAttachment.type` is inferred from the declared mime type.
- **Not a pixel-perfect API clone.** Fields that exist in the real API but that
  Mastodon.py never reads are omitted unless trivial to include.

## Primary consumer contract

> If `mastodon-py` doesn't support it, `mastodon_mock` doesn't support it either.

Concretely: the spec's endpoint coverage ([03-api-coverage.md](03-api-coverage.md)) is
derived by enumerating every `@api_version`-decorated method in `Mastodon.py/mastodon/*.py`
that issues an HTTP request, grouping by HTTP method + path template, and marking each
as one of:

- **Full** — implemented with real state changes / persistence.
- **Static** — implemented as a fixed-shape response (good enough because Mastodon.py
  callers don't usually assert much about it, e.g. `instance_peers`).
- **Stub/empty** — returns an empty list / 404 / `None` as appropriate so Mastodon.py
  doesn't choke, but no real backing data.
- **Out of scope** — not implemented; calling it returns 501 (or is simply not routed,
  producing Mastodon.py's `MastodonNotFoundError`).

All access from test code MUST go through Mastodon.py (`from mastodon import Mastodon`),
never raw `httpx`/`requests` calls to the mock — this keeps the "if Mastodon.py supports
it" contract honest and ensures the dual test-suite goal is achievable.

## Document map

- [01-architecture.md](01-architecture.md) — project layout, FastAPI app structure,
  SQLAlchemy + Alembic setup, SQLite (file vs in-memory) configuration, config file format.
- [02-data-model.md](02-data-model.md) — SQLAlchemy models / schema for accounts,
  statuses, relationships, media, notifications, etc.
- [03-api-coverage.md](03-api-coverage.md) — endpoint-by-endpoint coverage matrix.
- [04-auth.md](04-auth.md) — fake OAuth app registration / login / multi-account bearer
  tokens.
- [05-versioning.md](05-versioning.md) — how "current and current-1" version awareness
  works, and how the mock reports its version to Mastodon.py's version-check machinery.
- [06-testing.md](06-testing.md) — how the mock itself is tested, and how it's meant to
  be used as a fixture/dependency by a *consuming* project's dual test suites.
- [07-seeding-and-fixtures.md](07-seeding-and-fixtures.md) — seed data format for
  multi-account scenarios (pre-created users, pre-existing follows, etc.).
