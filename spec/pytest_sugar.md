# Spec: Test-Ergonomics Sugar (pytest plugin, context manager, decorator)

> Status: **proposed** (not yet implemented). This is a design spec for closing the
> single biggest usability gap in `mastodon_mock`: the amount of boilerplate a consumer
> must write to get a running mock server in their test suite.

## 1. The problem (the gap vs. moto)

`mastodon_mock` ships a server and a `create_app(config)` factory, but **nothing that
helps a consumer stand it up in a test**. Today, every consuming project copies ~30 lines
of fixture boilerplate into its own `conftest.py`:

```python
import socket, threading, time
import pytest, uvicorn
from mastodon import Mastodon
from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig, DatabaseConfig, SeedConfig, SeedAccount

def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]

@pytest.fixture()
def live_server():
    config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=...)
    app = create_app(config)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True); thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline: time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True; thread.join(timeout=5)

@pytest.fixture()
def alice(live_server):
    return Mastodon(access_token="alice_token", api_base_url=live_server)
```

This is error-prone (readiness races, port collisions, teardown leaks) and is **the exact
same code in every consuming repo**. It is library boilerplate masquerading as user code.

### What moto does that we don't

[moto](https://github.com/getmoto/moto) mocks AWS. Its entire value proposition is
ergonomics: a user adds **one decorator** (or one context manager, or one fixture) and
their existing `boto3` code transparently talks to the mock — no server URL plumbing, no
fixture boilerplate.

```python
from moto import mock_aws

@mock_aws
def test_s3():
    boto3.client("s3").create_bucket(Bucket="x")   # hits the mock, zero setup
```

We have **none of these affordances**:

| Affordance | moto | mastodon_mock (today) |
| -------------------------------- | ---- | --------------------- |
| Decorator (`@mock_...`) | ✅ | ❌ |
| Context manager (`with mock_...`)| ✅ | ❌ |
| Pytest fixture (shipped) | ✅ | ❌ (user hand-rolls) |
| Pytest plugin (auto-registered) | ✅ | ❌ |
| Zero-boilerplate client wiring | ✅ | ❌ |

Closing this gap is the highest-leverage usability work available: it turns "copy 30 lines
and hope the readiness wait is right" into "import one thing."

### One important difference from moto

moto can use a decorator that requires *no* base URL because `boto3` is configurable to a
fake endpoint via patching/`responses`. `Mastodon.py` talks over real HTTP via `requests`,
so our mock **must** be a real listening server and the client **must** be pointed at its
`api_base_url`. That means our sugar cannot fully hide the URL the way `@mock_aws` does —
but it can hand the user a **ready-to-use `Mastodon` client already pointed at the server**,
which is just as ergonomic in practice.

## 2. Goals

1. A consumer can get a running mock + a logged-in client in **one line**, no boilerplate.
1. Three entry styles, matching moto, so it fits any test style:
   - **pytest fixtures** (shipped via an auto-registered plugin) — the primary path.
   - **context manager** — for non-pytest tests or fine-grained control.
   - **decorator** — for the moto muscle-memory crowd.
1. Correct, race-free lifecycle: free-port allocation, readiness wait, guaranteed teardown,
   xdist-safe.
1. Sensible defaults (in-memory DB, a small known seed) with full override.
1. Zero new hard dependencies for people who only run the *server*; the test sugar lives
   behind a `test` extra.

## 3. Proposed public API

All sugar lives in a new module `mastodon_mock/testing/` (importable, typed, `py.typed`
already ships).

### 3.1 The core primitive: `MockServer`

A small, dependency-light handle that owns a threaded uvicorn server.

```python
from mastodon_mock.testing import MockServer

server = MockServer(seed=..., config=...)   # not yet started
server.start()                               # binds a free port, waits for readiness
server.base_url                              # "http://127.0.0.1:54321"
server.client("alice")                       # -> Mastodon(access_token=..., api_base_url=...)
server.client(token="raw_token")             # explicit token
server.reset()                               # POST /api/v1/_mock/reset
server.stop()                                # signals exit, joins thread
```

- `MockServer.client(username)` looks up the seeded account's `access_token`, so the user
  never handles tokens manually.
- `start()`/`stop()` are idempotent; `MockServer` is also a context manager (see 3.3).
- Free-port allocation + readiness polling + teardown live here, **once**.

### 3.2 Pytest fixtures (the primary path)

Shipped as a pytest plugin auto-registered via an entry point (see §5), so the user gets
the fixtures just by installing `mastodon_mock[test]` — no `pytest_plugins` line needed.

```python
# A user's test file — nothing in conftest.py required.

def test_follow(mastodon_mock_server):          # MockServer, fresh per test, in-memory
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.account_verify_credentials().id)
    bob.status_post("hi")
    assert any("hi" in s.content for s in alice.timeline_home())
```

Fixtures provided:

| Fixture | Scope | Yields | Notes |
| ------------------------ | -------- | ------------------------------- | -------------------------------------------------- |
| `mastodon_mock_server` | function | `MockServer` (started) | Fresh in-memory DB + seed per test. Max isolation. |
| `mastodon_mock_session` | session | `MockServer` (started) | One server for the whole run. |
| `mastodon_mock_reset` | function | `MockServer` | The session server, `reset()`-ed before each test. |
| `mastodon_mock_client` | function | `Mastodon` | Logged in as the first seeded account. |

Seed/config customisation without writing a fixture, via a marker and/or an override hook:

```python
import pytest
from mastodon_mock.config import SeedConfig, SeedAccount

CUSTOM_SEED = SeedConfig(accounts=[SeedAccount(username="zed", access_token="zed_token")])

@pytest.mark.mastodon_mock(seed=CUSTOM_SEED)
def test_with_custom_seed(mastodon_mock_server):
    zed = mastodon_mock_server.client("zed")
    ...
```

Or override the project-wide default by defining a fixture named
`mastodon_mock_config` (the plugin reads it if present):

```python
# conftest.py — optional, project-wide default seed/config
import pytest
from mastodon_mock.config import MastodonMockConfig, DatabaseConfig

@pytest.fixture()
def mastodon_mock_config():
    return MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=MY_SEED)
```

Precedence: per-test marker > `mastodon_mock_config` fixture > built-in default.

### 3.3 Context manager

For non-pytest tests, scripts, or when a test needs more than one server:

```python
from mastodon_mock.testing import mock_mastodon

with mock_mastodon(seed=MY_SEED) as server:
    alice = server.client("alice")
    alice.status_post("hello")
# server stopped on exit, even on exception
```

`mock_mastodon(...)` returns a started `MockServer` and guarantees `stop()` on exit. This
is the moto `with mock_aws():` analogue.

### 3.4 Decorator

For moto muscle memory. Because the client needs the URL, the decorator **injects the
`MockServer`** as an extra argument (named, by default, `mastodon_server`):

```python
from mastodon_mock.testing import mock_mastodon

@mock_mastodon(seed=MY_SEED)
def test_thing(mastodon_server):              # injected by the decorator
    alice = mastodon_server.client("alice")
    alice.status_post("hi")
```

`mock_mastodon` is **dual-use**: called with no test function it is a context manager
(§3.3); used to wrap a function it is a decorator. (moto's `mock_aws` works the same way.)
Injection is opt-out: `@mock_mastodon(inject=False)` runs the body inside a started server
without changing the signature, for tests that read a module-level base URL.

## 4. Implementation notes

- **Reuse `create_app`.** All three entry styles funnel into `MockServer`, which calls
  `create_app(config)` exactly as the existing in-repo `tests/conftest.py` does. No new
  server code paths.
- **Default config**: `MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=DEFAULT_TEST_SEED)` where `DEFAULT_TEST_SEED` provides `alice`/`bob`/`carol`
  (matching the in-repo fixtures) so examples "just work".
- **Free port**: bind `("127.0.0.1", 0)`, read back the port, close, hand to uvicorn —
  or pass `port=0` to uvicorn and read `server.servers[0].sockets[0].getsockname()`. The
  latter avoids the bind-close-rebind TOCTOU race; prefer it.
- **Readiness**: poll `server.started` with a deadline (default 10s, configurable), raise a
  clear `TimeoutError` on failure rather than hanging.
- **Teardown**: `should_exit = True` then `thread.join(timeout=...)`; log a warning if the
  thread doesn't join. Daemon thread as a backstop.
- **xdist**: per-worker free ports mean no coordination needed; the session-scoped fixture
  is per-worker, which is correct.
- **`client()` token lookup**: resolve `username -> SeedAccount.access_token` from the
  config the server was built with; raise a helpful error if the username isn't seeded or
  has no token.
- **No import-time cost for server-only users**: `mastodon_mock/testing/` imports
  `uvicorn`/`mastodon` lazily (inside functions) or is simply never imported unless the
  test extra is installed.

## 5. Packaging

- **New optional dependency group / extra** `test`:

  ```toml
  [project.optional-dependencies]
  test = ["uvicorn>=0.30.0", "mastodon.py>=2.2.1"]
  ```

  (`uvicorn` is already a core dep; `mastodon.py` is currently dev-only — the `client()`
  helper needs it, so it moves into the `test` extra.)

- **Auto-registered pytest plugin** via entry point so fixtures appear on install:

  ```toml
  [project.entry-points.pytest11]
  mastodon_mock = "mastodon_mock.testing.plugin"
  ```

  The plugin module registers the fixtures and the `mastodon_mock` marker
  (`pytest_configure` adds the marker to avoid `PytestUnknownMarkWarning`).

- Consumers install `pip install mastodon_mock[test]` and immediately have the fixtures,
  context manager, and decorator.

## 6. Migration / dogfooding

The in-repo `tests/conftest.py` currently *is* this boilerplate. Once `MockServer` lands,
rewrite the repo's own fixtures on top of it — the repo becomes the first consumer, which
keeps the sugar honest. The existing fixture names (`live_server`, `alice`, `bob`,
`fast_server`, …) can be re-expressed as thin wrappers over the shipped fixtures during a
transition.

## 7. Out of scope (for this spec)

- A truly URL-free decorator (monkeypatching `Mastodon`'s transport). Possible but fragile;
  the inject-the-server approach is simpler and explicit.
- ASGI-transport in-process mode (`httpx.ASGITransport`) as a `MockServer` backend. Useful
  for raw-HTTP tests but **not** for Mastodon.py (which uses `requests`), so deferred until
  there's demand.

## 8. Implementation checklist

- [ ] `mastodon_mock/testing/__init__.py` — exports `MockServer`, `mock_mastodon`.
- [ ] `mastodon_mock/testing/server.py` — `MockServer` (lifecycle, `client`, `reset`,
  context-manager protocol).
- [ ] `mastodon_mock/testing/sugar.py` — `mock_mastodon` dual-use context-manager/decorator.
- [ ] `mastodon_mock/testing/plugin.py` — pytest fixtures + marker, registered via
  `pytest11` entry point.
- [ ] `mastodon_mock/testing/seed.py` — `DEFAULT_TEST_SEED` (alice/bob/carol).
- [ ] `pyproject.toml` — `test` extra + `pytest11` entry point; move `mastodon.py` to it.
- [ ] Rewrite `tests/conftest.py` on top of `MockServer` (dogfood).
- [ ] Docs: a "Zero-boilerplate fixtures" section in
  [`docs/usage/writing-tests.md`](../docs/usage/writing-tests.md) and a mention on the
  landing page.
- [ ] Contract test that the shipped plugin's fixtures work in a subprocess `pytest` run.
