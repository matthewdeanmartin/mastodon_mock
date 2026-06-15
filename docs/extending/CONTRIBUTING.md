# Contributing

This guide is for people changing the mock's code. If you only want to *use* the mock in
tests, see [Writing Tests](../usage/writing-tests.md) instead. For the request lifecycle and
package layout, read [How It Works → For contributors](../overview/how-it-works.md#for-contributors)
first — this page assumes that orientation.

## Setup

```bash
git clone https://github.com/matthewdeanmartin/mastodon_mock.git
cd mastodon_mock
uv sync
make pre-commit-install      # install git hooks (one time)
```

All tooling runs inside the project's locked virtualenv via `uv run` (or the `make`
targets, which wrap it).

## The quality gate

```bash
make check         # format-check + lint + security + tests + typecheck + metadata
make test          # pytest with coverage
make lint          # ruff + pylint (main + tests)
make typecheck     # mypy --strict
make security      # bandit + pip-audit
make prerelease    # everything above + docs/spell/smoke checks — run before a PR
```

`make check` must pass before merging. `make format` auto-fixes formatting (isort, black,
ruff, mdformat).

## Where things live

| You want to change… | Edit… |
| ------------------------------------ | ------------------------------------------ |
| What an endpoint does | `mastodon_mock/routers/<area>.py` |
| The JSON shape returned to a client | `mastodon_mock/serializers/<area>.py` |
| Persisted state (tables/columns) | `mastodon_mock/db/models.py` (+ migration) |
| Seed/startup data | `mastodon_mock/db/seed.py`, `config.py` |
| Auth / current-user resolution | `mastodon_mock/deps.py` |
| Cross-cutting writes (notifications) | `mastodon_mock/services.py` |
| Pagination / `Link` headers | `mastodon_mock/pagination.py` |

Routers and serializers mirror `Mastodon.py`'s own module split, so a client method like
`status_favourite` maps to `routers/statuses.py` → `serializers/statuses.py`.

## Adding an endpoint, end to end

Suppose Mastodon.py calls `GET /api/v1/widgets/{id}` via a `widget(id)` method and you want
the mock to support it statefully.

1. **Model the state.** Add a `Widget` model to `db/models.py` if it needs persistence, then
   generate a migration (see below). Skip this if you're returning a static/stub shape.

1. **Write the serializer.** Add `serialize_widget(db, widget, config)` to
   `serializers/widgets.py` returning the exact JSON shape Mastodon.py expects. Cross-check
   the field names against what the client reads.

1. **Add the route.** In `routers/widgets.py`:

   ```python
   @router.get("/api/v1/widgets/{widget_id}")
   def get_widget(widget_id: str, db: DbSession, config: Config) -> dict[str, Any]:
       widget = db.get(Widget, int(widget_id))
       if widget is None:
           raise HTTPException(status_code=404, detail="Record not found")
       return serialize_widget(db, widget, config)
   ```

   Use the `DbSession`, `Config`, `CurrentAccount` / `RequiredAccount` dependencies from
   `deps.py`. `RequiredAccount` enforces a `401` for endpoints that need a logged-in user.

1. **Register the router** in `app.py` (`app.include_router(...)`) if the module is new.

1. **For list endpoints, paginate** with `pagination.paginate(...)` and set the `Link`
   header so Mastodon.py's `fetch_next` works — don't roll your own.

1. **Write a contract test** (see below) that drives the new endpoint through Mastodon.py.

1. **Update coverage docs** — add a row to [the coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md)
   and, if it shifts the summary, [the coverage reference](../reference/coverage.md).

### Conventions

- IDs are stringified integers; use `ids.py` for new monotonic IDs and accept `str` path
  params, coercing with `int(...)` inside a `try/except`.
- Return Mastodon-shaped errors: `404` → `{"detail": "Record not found"}`, validation
  `422` → `{"error": "..."}` (what Mastodon.py expects).
- Side-effect notifications go through `services.py`, not inline in the router.

## Database migrations

Alembic is the source of truth for schema; `create_all()` is only a convenience for
in-memory/test databases.

```bash
# after changing db/models.py:
uv run alembic revision --autogenerate -m "add widgets table"
# review the generated file in mastodon_mock/alembic/versions/, then:
uv run alembic upgrade head
```

There's a drift test (`tests/test_alembic_drift.py`) that fails if the models and the
migrations disagree — run `make test` to catch a forgotten migration.

## Testing layers

The suite has three layers (see [the testing spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/06-testing.md) for detail):

1. **Unit tests** — serializers, pagination, ID generation, config loading, seed
   idempotency. Pure Python, `:memory:` SQLite, no HTTP. Fast; prefer these for logic.
1. **Router/integration tests** — drive `create_app(config)` in-process. Good for
   persistence and shape assertions without a socket.
1. **Mastodon.py contract tests** — the important ones. They start a real `uvicorn` server
   and drive it *only* through Mastodon.py's public API, proving the mock works against a
   genuine client (request building, pagination unwrapping, type casting). New endpoints
   should get one of these.

Mock-only behaviour (e.g. `/api/v1/_mock/*`) lives under `tests/mock_only/` so it's never
collected against a real backend. `tests/integration/` holds the dual mock/real suite,
excluded from the default `pytest` run and gated behind `RUN_REAL_MASTODON_TESTS=1`.

A typical contract test:

```python
def test_widget_round_trips(alice):                 # alice: a logged-in Mastodon client
    created = alice.some_method_that_creates_a_widget(...)
    fetched = alice.widget(created.id)
    assert fetched.id == created.id
```

## Before submitting a PR

```bash
make prerelease
```

This runs the full gate plus docs, spelling, and CLI smoke checks. Keep new code's comment
density and naming consistent with the surrounding module, and update the relevant spec /
docs page whenever you change behaviour or coverage.
