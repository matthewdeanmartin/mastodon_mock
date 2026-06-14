# Testing Strategy

There are two distinct testing concerns:

1. **Testing `mastodon_mock` itself** (this repo's `tests/`).
2. **Using `mastodon_mock` as a dependency** in a *consuming* project's dual test
   suite (mock-backed + real-server-backed), which is the actual end goal stated in
   [00-overview.md](00-overview.md).

## 1. Testing `mastodon_mock` itself

### Layers

- **Unit tests** — serializers (`serializers/*.py`), pagination helper, ID generation,
  config loading (`.mastodon_mock.toml` vs `pyproject.toml` precedence), seed
  application idempotency. Pure Python, no HTTP, SQLite `:memory:` per test.
- **Router/integration tests** — `httpx.ASGITransport(app=create_app(test_config))` +
  `httpx.Client(transport=..., base_url="http://mock")`. Fast, in-process, no real
  sockets. Used for most endpoint-shape and persistence assertions (does
  `POST /api/v1/statuses` followed by `GET /api/v1/timelines/home` show the new
  status?).
- **Mastodon.py contract tests** — the real differentiator. These tests import
  `from mastodon import Mastodon` (the vendored `Mastodon.py/` package — pinned as a
  dependency, see "Dependency on Mastodon.py" below) and drive the mock **only**
  through Mastodon.py's public API, never raw HTTP. This is what proves "if
  mastodon.py can call it, the mock handles it" end-to-end, including Mastodon.py's
  own request-building, pagination unwrapping, and type-casting (`AttribAccessDict`
  attribute access, `datetime` parsing, etc.).

  These tests need a **real running server** (Mastodon.py uses `requests` under the
  hood, not an ASGI transport), so:

  ```python
  # tests/conftest.py
  import threading, time
  import uvicorn
  import pytest
  from mastodon_mock.app import create_app
  from mastodon_mock.config import MastodonMockConfig, DatabaseConfig

  @pytest.fixture()
  def live_server():
      config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=DEFAULT_TEST_SEED)
      app = create_app(config)
      server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
      thread = threading.Thread(target=server.run, daemon=True)
      thread.start()
      while not server.started:
          time.sleep(0.01)
      port = server.servers[0].sockets[0].getsockname()[1]
      yield f"http://127.0.0.1:{port}"
      server.should_exit = True
      thread.join(timeout=5)
  ```

  Port `0` → OS-assigned free port, so tests can run with `pytest-xdist` in parallel
  without collisions. `StaticPool` in-memory SQLite (see
  [01-architecture.md](01-architecture.md)) keeps state shared across the threadpool
  requests within this single `app`/`engine`.

### Dependency on Mastodon.py

`Mastodon.py/` is currently a **nested git clone inside this repo** (per the user's
note: "I cloned a repo to inside a repo"). For the spec's purposes:

- `mastodon_mock`'s own test suite needs `mastodon` importable. Either:
  - (a) add `Mastodon.py` as a normal PyPI dependency (`mastodon.py>=...`) in the `dev`
    dependency group — **simplest**, and decouples this repo from the nested clone, **or**
  - (b) keep the nested clone as a vendored reference/spec source (as it is now, useful
    for re-running the endpoint-inventory greps in [03-api-coverage.md](03-api-coverage.md)
    when Mastodon.py updates) but install `mastodon.py` from PyPI for actual test runs.
- **Recommendation**: (b). Add `mastodon.py` to `[dependency-groups] dev` via PyPI.
  Keep `Mastodon.py/` un-tracked or as a reference checkout (it's already `??` in `git
  status` — i.e., not yet committed; decide whether to `.gitignore` it or add as a
  documented "reference copy, not a build dependency" — **out of scope for this spec,
  flag for the user**).

### Fixture: seeded multi-account scenario

A reusable pytest fixture provides exactly the scenario from the user's prompt
("create a user, follow them, then see the new follow/post show up"):

```python
@pytest.fixture()
def two_users(live_server):
    alice = Mastodon(access_token="alice_token", api_base_url=live_server)
    bob = Mastodon(access_token="bob_token", api_base_url=live_server)
    return alice, bob

def test_follow_then_timeline(two_users):
    alice, bob = two_users
    bob_id = bob.account_verify_credentials().id

    alice.account_follow(bob_id)
    rel = alice.account_relationships(bob_id)[0]
    assert rel.following is True

    bob.status_post("hello from bob")
    home = alice.timeline_home()
    assert any("hello from bob" in s.content for s in home)
```

### What "passing" means for this repo's tests

- `make test` runs the full pytest suite against `:memory:` SQLite by default —
  fast, no leftover files.
- A separate `tests/test_file_db.py` (or a parametrized fixture) exercises the
  file-backed path at least once, to catch `StaticPool`/threading issues that only
  manifest with the default pool.
- `make check` (lint/typecheck/security/test) must pass before merging — same as any
  other change in this repo, per `AGENTS.md`.

## 2. Using `mastodon_mock` in a consuming project's dual suite

This is the actual deliverable the user is building toward — `mastodon_mock` exists so
*another* project's test suite can do:

```python
# consuming_project/tests/conftest.py
import pytest

@pytest.fixture(params=["mock", "real"])
def mastodon_client(request, mock_server_url):
    if request.param == "mock":
        return Mastodon(access_token="alice_token", api_base_url=mock_server_url)
    else:
        if not os.environ.get("RUN_REAL_MASTODON_TESTS"):
            pytest.skip("set RUN_REAL_MASTODON_TESTS=1 to run against a real instance")
        return Mastodon(access_token=os.environ["REAL_MASTODON_TOKEN"], api_base_url=os.environ["REAL_MASTODON_URL"])

def test_post_and_read_back(mastodon_client):
    status = mastodon_client.status_post("integration test post")
    fetched = mastodon_client.status(status.id)
    assert fetched.content == status.content
    mastodon_client.status_delete(status.id)  # cleanup, especially important for "real"
```

### Design implications this places on `mastodon_mock`

1. **Response shapes must be close enough** that the *same* assertions
   (`status.content`, `status.account.acct`, `rel.following`, etc.) hold for both mock
   and real. This is why [03-api-coverage.md](03-api-coverage.md) marks fields/endpoints
   Mastodon.py actually reads as **Full**, even when other fields are stubbed.
2. **Determinism vs realism trade-off**: the mock should produce *plausible* values
   (real-looking `created_at` timestamps, monotonic IDs, HTML-wrapped `content`) so
   tests that do basic shape assertions (`isinstance(status.created_at, datetime)`)
   pass identically against both backends.
3. **Cleanup-sensitive tests** (delete/unfollow at the end) should work identically —
   since the mock has no soft-delete-with-grace-period quirks, `status_delete`
   followed by `status(id)` should raise `MastodonNotFoundError` (404) on **both**
   backends.
4. **Tests that are inherently mock-only** (e.g. asserting on `mastodon_mock`-specific
   behavior like the `/api/v1/_mock/login` convenience endpoint from
   [04-auth.md](04-auth.md)) must be clearly separated — e.g. a
   `@pytest.mark.mock_only` marker, or living in a `tests/mock_only/` directory —
   so the "real" parametrization doesn't even attempt to collect them.
5. **Rate limiting**: real Mastodon returns `429` + `X-RateLimit-*` headers under load.
   The mock does **not** implement rate limiting by default (config
   `auth.permissive`/no rate limit). If the consuming suite specifically tests
   `ratelimit_method="throw"` handling, that's a `mock_only`-style test against a mock
   configured with `[tool.mastodon_mock.ratelimit] enabled = true` — a **stretch goal**,
   not v1.

### Suggested layout in the consuming project

```
consuming_project/
└── tests/
    ├── conftest.py            # mastodon_client fixture (params: mock, real)
    ├── test_statuses.py        # runs against both
    ├── test_follows.py         # runs against both
    └── mock_only/
        └── test_mock_admin.py  # mock-specific helper endpoints, seed verification, etc.
```

Run modes:

```bash
uv run pytest                                  # mock only (real tests skipped)
RUN_REAL_MASTODON_TESTS=1 uv run pytest        # both, real ones hit the live instance
uv run pytest -m "not mock_only"               # for CI against real server, exclude mock-only tests
```

## CI considerations for this repo

- The mock-backed tests (layer 1 above) run in every CI job — they're fast and have no
  external dependencies.
- This repo does **not** need a "real Mastodon" CI job — that's the consuming project's
  concern. This repo's job is to be a faithful-enough mock; its own tests prove that
  via the Mastodon.py contract tests.
