# Architecture

## Stack

| Concern          | Choice                                                                |
|------------------|------------------------------------------------------------------------|
| HTTP framework   | **FastAPI** (ASGI, runs under `uvicorn`)                              |
| ORM              | **SQLAlchemy** 2.x (declarative models, sync engine)                  |
| Migrations       | **Alembic**                                                           |
| Database         | **SQLite** — file-backed by default, optional **in-memory**          |
| Validation       | Pydantic v2 (comes with FastAPI) for request/response shaping         |
| Auth             | Fake OAuth — see [04-auth.md](04-auth.md)                             |
| Config           | `.mastodon_mock.toml` or `[tool.mastodon_mock]` in `pyproject.toml`   |
| Test runner      | `pytest` + `httpx.ASGITransport` for in-process requests, real `uvicorn` for out-of-process |

### Why sync SQLAlchemy + FastAPI

FastAPI happily runs sync path operation functions in a threadpool. Given the small
scale (a handful of accounts, statuses measured in the hundreds per test run) and the
desire for **simple, debuggable** code over throughput, sync SQLAlchemy sessions
(`Session`, not `AsyncSession`) are used throughout. This also makes the in-memory
SQLite mode trivial (no async driver gymnastics with `aiosqlite`).

## Package layout

```
mastodon_mock/
├── __init__.py
├── __about__.py
├── __main__.py
├── cli.py                  # `mastodon_mock serve`, `mastodon_mock init-db`, etc.
├── config.py               # loads .mastodon_mock.toml / pyproject [tool.mastodon_mock]
├── app.py                  # FastAPI() factory: create_app(config) -> FastAPI
├── db/
│   ├── __init__.py
│   ├── base.py             # SQLAlchemy declarative Base, session factory, engine setup
│   ├── models.py           # ORM models (see 02-data-model.md)
│   └── seed.py             # applies seed data from config/fixtures (see 07-seeding-and-fixtures.md)
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial.py
├── alembic.ini
├── deps.py                  # FastAPI dependencies: get_db(), get_current_account()
├── ids.py                   # snowflake-ish ID generation (Mastodon IDs are stringified ints)
├── serializers/
│   ├── __init__.py
│   ├── accounts.py          # ORM Account -> Mastodon `Account` JSON shape
│   ├── statuses.py          # ORM Status -> Mastodon `Status` JSON shape
│   ├── relationships.py
│   ├── instance.py
│   └── notifications.py
├── routers/
│   ├── __init__.py
│   ├── oauth.py             # /api/v1/apps, /oauth/token, /.well-known/oauth-authorization-server
│   ├── instance.py          # /api/v1/instance, /api/v2/instance, /api/v1/instance/peers, etc.
│   ├── accounts.py          # /api/v1/accounts/*
│   ├── statuses.py          # /api/v1/statuses/*
│   ├── timelines.py         # /api/v1/timelines/*
│   ├── notifications.py
│   ├── media.py             # /api/v2/media, /api/v1/media/:id
│   ├── search.py
│   ├── lists.py
│   ├── favourites_bookmarks.py
│   ├── relationships.py     # /api/v1/follow_requests, /api/v1/mutes, /api/v1/blocks, /api/v1/domain_blocks
│   ├── filters.py
│   ├── polls.py
│   ├── preferences.py
│   └── conversations.py
└── py.typed
```

This mirrors the module split in `Mastodon.py/mastodon/*.py` reasonably closely, which
makes it easy to cross-reference "does `accounts.py`'s `account_follow` have a
corresponding route in `routers/accounts.py`?".

## Application factory

```python
# mastodon_mock/app.py
from fastapi import FastAPI
from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.base import init_engine, Base
from mastodon_mock.db.seed import apply_seed_data
from mastodon_mock.routers import oauth, instance, accounts, statuses, timelines, ...

def create_app(config: MastodonMockConfig | None = None) -> FastAPI:
    config = config or MastodonMockConfig.load()
    engine = init_engine(config.database)
    Base.metadata.create_all(engine)  # for in-memory/sqlite "quick start" without alembic
    apply_seed_data(engine, config.seed)

    app = FastAPI(title="mastodon_mock", version=config.mocked_mastodon_version)
    app.state.config = config
    app.state.engine = engine

    app.include_router(oauth.router)
    app.include_router(instance.router)
    app.include_router(accounts.router)
    app.include_router(statuses.router)
    app.include_router(timelines.router)
    # ... etc
    return app
```

Notes:

- `Base.metadata.create_all(engine)` gives a zero-config quick start (especially for
  `:memory:`), while **Alembic remains the source of truth for schema** and is used for
  file-backed DBs / CI / anything that should detect drift. See "Alembic vs
  create_all" below.
- `apply_seed_data` is idempotent — re-running it against an existing DB should not
  duplicate seeded accounts (match on `username`).

## Running the server

```bash
mastodon_mock serve                      # reads .mastodon_mock.toml from cwd
mastodon_mock serve --config path/to.toml
mastodon_mock serve --in-memory          # force sqlite :memory: regardless of config
mastodon_mock serve --port 3000 --host 127.0.0.1
```

`mastodon_mock serve` runs `uvicorn.run(create_app(config), host=..., port=...)`.

For test fixtures, a Python API is also exposed:

```python
from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig

app = create_app(MastodonMockConfig(database=DatabaseConfig(driver="sqlite", path=":memory:")))
```

…which a pytest fixture can wrap in `uvicorn` (via a thread/subprocess, for a real
`api_base_url`) or drive directly with `httpx.ASGITransport(app=app)` for no-network
tests. See [06-testing.md](06-testing.md).

## SQLite: file vs in-memory

SQLite supports `:memory:` databases. Two caveats drive the design:

1. **`:memory:` is connection-scoped.** Each new `sqlite3` connection gets its own
   empty database. SQLAlchemy's default pooling would hand out different connections
   to different requests, each seeing an empty DB. **Fix**: when `database.path ==
   ":memory:"`, the engine MUST be created with
   `poolclass=StaticPool` and `connect_args={"check_same_thread": False}`, e.g.:

   ```python
   from sqlalchemy import create_engine
   from sqlalchemy.pool import StaticPool

   engine = create_engine(
       "sqlite://",
       connect_args={"check_same_thread": False},
       poolclass=StaticPool,
   )
   ```

   This keeps a single shared connection alive for the lifetime of the engine, so all
   requests see the same in-memory DB.

2. **`check_same_thread=False`** is required in both file and memory modes because
   FastAPI's sync endpoints run in a threadpool, and a given SQLAlchemy `Session` may
   be used from a different thread than the connection was created on. Since the mock
   is single-process/local-only, the usual cross-thread-sqlite caveats are acceptable.

### Config knob

```toml
[tool.mastodon_mock.database]
driver = "sqlite"
path = ":memory:"          # or "./mastodon_mock.db" / "/abs/path/to.db"
echo = false                # SQLAlchemy echo (SQL logging) for debugging
```

- `path = ":memory:"` → `StaticPool`, ephemeral, perfect for pytest (each test session
  gets a clean slate, or each test gets its own app instance for full isolation).
- `path = "./mastodon_mock.db"` → normal file-backed SQLite, persists across server
  restarts (useful for manually poking at the mock with `curl`/Mastodon.py during
  development, or for longer-lived local dev servers).

## Alembic vs `create_all`

- **Alembic is canonical.** `alembic/versions/` holds the real migration history;
  `alembic upgrade head` is how file-backed DBs get their schema in CI / dev.
- **`create_all` is a convenience fallback** for `:memory:` and for fresh file DBs in
  tests, so a test doesn't need to shell out to `alembic`. `create_app()` always calls
  `Base.metadata.create_all(engine, checkfirst=True)` which is a no-op if the schema
  already exists (e.g., file DB already migrated by Alembic).
- A `make` target / CLI subcommand `mastodon_mock db upgrade` runs
  `alembic upgrade head` against the configured `path`.
- Models live in `mastodon_mock/db/models.py`; Alembic's `env.py` imports
  `Base.metadata` from there for autogeneration (`alembic revision --autogenerate`).

## Configuration file

Two supported locations, checked in this order:

1. `./.mastodon_mock.toml` (project-local override, e.g. for a consuming project's test
   suite that wants its own seed data)
2. `[tool.mastodon_mock]` table in `./pyproject.toml`

CLI flags override file config; file config overrides built-in defaults.

### Schema (TOML)

```toml
[tool.mastodon_mock]
# The Mastodon version string this mock claims to be, used in:
#  - /api/v1/instance (and v2) "version" field
#  - /api/v2/instance "api_versions" field
#  - exposed so Mastodon.py's retrieve_mastodon_version() and
#    @api_version(...) checks behave like talking to this version.
mocked_version = "4.5.0"     # "current". current-1 also testable, see 05-versioning.md
domain = "mock.local"
title = "Mastodon Mock"

[tool.mastodon_mock.database]
driver = "sqlite"
path = ":memory:"
echo = false

[tool.mastodon_mock.server]
host = "127.0.0.1"
port = 3000

[tool.mastodon_mock.auth]
# If true, any bearer token is accepted and mapped to the *first* seeded account.
# Useful for quick read-only smoke tests. Default false.
permissive = false

[[tool.mastodon_mock.seed.accounts]]
username = "alice"
display_name = "Alice"
locked = false
bot = false
# token is what tests pass to Mastodon(access_token=...)
access_token = "alice_token"

[[tool.mastodon_mock.seed.accounts]]
username = "bob"
display_name = "Bob"
access_token = "bob_token"

[[tool.mastodon_mock.seed.follows]]
follower = "alice"
following = "bob"
```

Equivalently, under `pyproject.toml`:

```toml
[tool.mastodon_mock]
mocked_version = "4.5.0"
# ... same shape as above, just nested under [tool.mastodon_mock.*]
```

`MastodonMockConfig.load()`:

1. If `.mastodon_mock.toml` exists in CWD (or a path passed explicitly), load it as the
   *entire* document (top-level keys, no `[tool.mastodon_mock]` wrapper needed).
2. Else, look for `pyproject.toml` in CWD and read `[tool.mastodon_mock]`.
3. Else, use built-in defaults (in-memory SQLite, `mocked_version` = current pinned
   version from [05-versioning.md](05-versioning.md), no seed accounts beyond a single
   default `testuser`).

Implementation: `tomllib` (stdlib, Python 3.13) for reading; a `pydantic` (or
`dataclasses` + manual validation) model `MastodonMockConfig` for typed access.
