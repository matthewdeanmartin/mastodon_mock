# How It Works

`mastodon_mock` is a real [FastAPI](https://fastapi.tiangolo.com/) application that speaks
the Mastodon HTTP REST API and persists state in SQLite. It is *not* a request recorder or
a fixture library — when you `POST /api/v1/statuses`, a row is written to a `statuses`
table, and a later `GET /api/v1/timelines/home` runs a real query against that table. This
is what makes it **stateful**: writes are reflected in subsequent reads, exactly as they
would be against a live server.

This page has two halves. Read the part that matches what you're doing:

- **[For test authors](#for-test-authors)** — you want to point a Mastodon client at the
  mock and assert on behaviour. You care about *what the server does*, not how.
- **[For contributors](#for-contributors)** — you want to change the mock's code. You care
  about *how a request becomes a database row and a JSON response*.

Authentication is explained once, in its own section, because it matters to both:
[Authentication](#authentication).

______________________________________________________________________

## For test authors

### The mental model

Think of the mock as a tiny, disposable Mastodon instance that:

- starts in milliseconds,
- comes pre-populated with accounts *you* declare (the **seed**),
- has every account's access token fixed and known up front, so there's no OAuth dance,
- forgets everything when the process exits (with `:memory:` SQLite, the default), and
- can be reset to its seed state on demand without restarting.

Because it implements the actual HTTP API, you drive it with a **real Mastodon client** —
this project is tested against [Mastodon.py](https://github.com/halcy/Mastodon.py) — and
the same client code that talks to a production server talks to the mock unchanged. The
only difference is `api_base_url`.

### What "stateful" buys you

You can write the kind of test that's painful against a real server:

```python
from mastodon import Mastodon

alice = Mastodon(access_token="alice_token", api_base_url="http://127.0.0.1:3000")
bob = Mastodon(access_token="bob_token", api_base_url="http://127.0.0.1:3000")

bob_id = bob.account_verify_credentials().id
alice.account_follow(bob_id)

bob.status_post("hello from bob")

# Alice follows Bob, so Bob's post shows up on Alice's home timeline:
home = alice.timeline_home()
assert any("hello from bob" in s.content for s in home)
```

No network flakiness, no rate limits, no leftover test posts on a public instance, and
fully deterministic — Alice's timeline contains exactly what your test put there.

### Where state lives and how to reset it

State lives in the SQLite database for the lifetime of the server process. Two patterns:

- **Fresh server per test** — start a new in-memory server in a fixture and tear it down
  after. Maximum isolation, slightly slower.

- **One shared server, reset between tests** — start the server once and call the mock-only
  reset endpoint before each test to drop everything back to the seed:

  ```python
  import httpx2 as httpx
  httpx.post(f"{server_url}/api/v1/_mock/reset")  # drops + recreates tables, re-seeds
  ```

  Much faster for large suites. See [Writing Tests](../usage/writing-tests.md) for ready-made
  fixtures implementing both.

### What's mocked and what isn't

The high-traffic surface (accounts, statuses, timelines, notifications, lists, filters,
media, polls, search, OAuth) is **fully stateful**. Some endpoints return fixed or empty
shapes, and a few are deliberately not routed at all. Before you assert on something, check
[What Is and Isn't Mocked](../reference/coverage.md) so you know whether you're testing
real behaviour or a stub.

______________________________________________________________________

## For contributors

### Request lifecycle

A request flows through these layers (all under `mastodon_mock/`):

```
HTTP request
   │
   ▼
middleware.py        optional scope-enforcement / rate-limiting (off by default)
   │
   ▼
routers/<area>.py    FastAPI path operation; parses params, calls into the DB
   │
   ├─ deps.py        dependency-injected Session, current token, current account
   │
   ├─ db/models.py   SQLAlchemy ORM models — the source of truth for state
   │
   ├─ services.py    cross-cutting writes (e.g. notification generation, mention parsing)
   │
   ▼
serializers/<area>.py   ORM object → Mastodon-shaped JSON dict
   │
   ▼
HTTP response (JSON, with Link header for paginated lists)
```

### The pieces

- **`app.py`** — `create_app(config)` is the application factory. It builds the engine,
  runs `Base.metadata.create_all()` (a zero-config convenience; Alembic remains the schema
  source of truth), applies seed data, stashes `config`/`engine` on `app.state`, and
  includes every router. Tests call this directly.
- **`config.py`** — Pydantic models for configuration plus `MastodonMockConfig.load()`,
  which resolves `.mastodon_mock.toml` → `[tool.mastodon_mock]` in `pyproject.toml` →
  built-in defaults.
- **`db/base.py`** — declarative `Base`, engine creation, and the session factory. For
  in-memory SQLite (`path = ":memory:"`) it transparently backs the engine with a private
  temp file (deleted on dispose) rather than a true `sqlite://` memory DB, so each
  threadpool request gets its **own** connection instead of sharing one fragile connection.
  See [Database: file vs in-memory](#database-file-vs-in-memory).
- **`db/models.py`** — the ORM models. This is where persisted state is defined; changing
  it means writing an Alembic migration.
- **`db/seed.py`** — `apply_seed_data()`, idempotent (matches accounts on `username`), turns
  the seed config into rows including the fixed `oauth_tokens` rows that make pre-seeded
  access tokens work.
- **`db/sample_data.py`** — fast, append-only bulk generation for throwaway local cohorts.
  It pre-allocates IDs, inserts in chunks, and temporarily applies SQLite bulk-load PRAGMAs.
- **`deps.py`** — FastAPI dependencies: `get_db()`, `get_current_token()`,
  `get_current_account()`, and the `RequiredAccount` dependency that raises `401` when a
  write endpoint has no authenticated user.
- **`routers/`** — one module per API area, mirroring `Mastodon.py`'s module split so you
  can cross-reference a client method to its route.
- **`serializers/`** — pure functions turning ORM objects into the exact JSON shapes
  Mastodon.py expects. The contract tests assert on these shapes, so they're the part most
  likely to break a consumer.
- **`pagination.py`** — the shared `paginate(...)` helper that applies
  `max_id`/`min_id`/`since_id`/`limit` and produces the `Link` header that Mastodon.py's
  `PaginatableList` reads.
- **`ui.py`** — mounts the built Angular single-page app at `/_ui/` when the bundle exists.
  Missing UI assets do not stop the API server from starting.
- **`ids.py`** — monotonic, stringified-int IDs (Mastodon IDs are strings of snowflake-ish
  integers).

### Database: file vs in-memory

In-memory SQLite (`path = ":memory:"`, the default) is connection-scoped — a naive pool
would hand each request a different, empty database. The obvious fix is `StaticPool`, which
shares **one** connection for the engine's lifetime. But that connection is then used by
every request, and FastAPI runs sync endpoints in a **threadpool** — so two requests on
different threads use the same connection at once. A single SQLite connection is not safe
for concurrent cross-thread use; `check_same_thread=False` only silences the guard, it does
not serialize access. Interleaved statements (classically: an SSE stream resolving its
account while another request commits a write) can make a query observe half-applied state
and return wrong/empty rows. That surfaced as an intermittent, load-dependent **`401`** when
a token lookup transiently saw nothing — reproducible only under `pytest -n auto`.

So `db/base.py` does **not** share a single connection. For `:memory:` it transparently
backs the engine with a *private temp file* (unique per engine, deleted on dispose) and
uses the default connection pool, so each threadpool request gets its **own** connection and
SQLite's normal file locking coordinates them safely. The database is still ephemeral and
isolated per app instance, preserving the `:memory:` contract for tests. (Shared-cache
in-memory, `cache=shared`, was rejected: it trades the race for SQLite crashes under
threaded load.)

File-backed SQLite (`path = "./something.db"`) already gives each connection its own handle,
persists across restarts, and is useful for poking at the mock with `curl` during
development. See [the architecture spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/01-architecture.md) for the full
rationale, and [Writing Tests → Parallelism and SQLite](../usage/writing-tests.md#parallelism-and-sqlite)
for what this means when running suites in parallel.

For how to add a new endpoint end-to-end, see [Contributing](../extending/CONTRIBUTING.md).

______________________________________________________________________

## Authentication

> **Security is faked, not enforced.** The mock's only goal is that a real client's auth
> code paths work *mechanically*. There is no password checking, no client-secret
> validation, and (by default) no scope enforcement.

### Tokens are just strings mapped to accounts

Every authenticated request carries `Authorization: Bearer <token>`. The mock resolves the
token to an `oauth_tokens` row, and that row's `account_id` is "who you are". Seeded
accounts get a **fixed, known token** (whatever you put in the seed config), so tests can
construct a logged-in client directly:

```python
alice = Mastodon(access_token="alice_token", api_base_url="http://127.0.0.1:3000")
```

This is the **recommended workflow** — it skips OAuth entirely and lets one test hold
several clients logged in as different accounts interacting with shared state.

### The three ways to "log in"

1. **Pre-seeded token (recommended).** Declare `access_token` in the seed; pass it to
   `Mastodon(access_token=...)`. No HTTP auth dance.
1. **App registration + `client_credentials`.** `Mastodon.create_app(...)` →
   `POST /api/v1/apps` returns a random `client_id`/`client_secret`. `POST /oauth/token`
   with `grant_type=client_credentials` always succeeds and returns an *app-only* token
   (no user). This is what `create_account()` uses for its first step.
1. **Self-service signup.** `create_account(username, password, email, agreement=True)`
   does the `client_credentials` step then `POST /api/v1/accounts`, creating a new account
   and returning a usable user token (no email-confirmation step is modeled).

There is also a clearly-named **mock-only** shortcut, `POST /api/v1/_mock/login` with
`{"username": "alice"}`, which mints a fresh user token for a seeded account.

For interactive development, `POST /api/v1/_mock/dev_user` creates a new local user plus a
token, and `GET /api/v1/_mock/dev_users` lists tokened local accounts for the UI login
screen. These endpoints are intentionally mock-only.

### What the grant types do

| `grant_type` | Behaviour |
| -------------------- | ------------------------------------------------------------------------- |
| `client_credentials` | Always succeeds; returns an app-only token (`account_id` is null). |
| `refresh_token` | Supported; looks up the token by `refresh_token`, issues a new one. |
| `authorization_code` | **Not supported** (400) — requires a browser redirect, out of scope. |
| `password` | **Not supported** (400) — removed in real Mastodon 4.4+, so removed here. |

### Required vs optional auth

- Endpoints that require a user (e.g. `status_post`, `account_follow`,
  `account_verify_credentials`) return **401** if the token doesn't resolve to an account.
- Endpoints that work with or without auth (e.g. `status`, `timeline_public`) treat "no
  user" as "no ownership/relationship context" — fields like `favourited`/`reblogged` come
  back `False`.

### Optional strictness knobs (off by default)

- `[tool.mastodon_mock.auth] permissive = true` — any/no token maps to the first seeded
  account (handy for quick read-only smoke tests).
- `[tool.mastodon_mock.auth] enforce_scopes = true` — coarse scope checks: write methods
  (`POST`/`PUT`/`PATCH`/`DELETE`) need the `write` scope, others need `read`; mismatch
  returns `403`.
- `[tool.mastodon_mock.ratelimit] enabled = true` — return `429` + `X-RateLimit-*` headers
  after `limit` requests per token per window, to exercise Mastodon.py's `ratelimit_method`.

See [the auth spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/04-auth.md) for the exact bearer-token resolution code.
