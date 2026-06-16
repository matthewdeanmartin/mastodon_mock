# Writing Tests Against the Mock

This guide is for **test authors** — people testing client code (their own, or a library
built on Mastodon.py) who want a fast, deterministic Mastodon to point it at. For how the
mock works internally, see [How It Works](../overview/how-it-works.md); for the exact
endpoint coverage, see [What Is and Isn't Mocked](../reference/coverage.md).

## The core idea

You run the mock as a real HTTP server on a local port, then create one or more
[Mastodon.py](https://github.com/halcy/Mastodon.py) clients pointed at it. Each seeded
account has a fixed access token, so you skip OAuth entirely and just construct logged-in
clients.

```python
from mastodon import Mastodon

alice = Mastodon(access_token="alice_token", api_base_url="http://127.0.0.1:3000")
alice.status_post("hello, mock!")
```

## Defining your accounts (the seed)

The mock starts with the accounts you declare in its **seed config**. You can supply this
in Python (best for tests) or in a TOML file.

```python
from mastodon_mock.config import (
    MastodonMockConfig, DatabaseConfig, SeedConfig, SeedAccount, SeedFollow,
)

TEST_SEED = SeedConfig(
    accounts=[
        SeedAccount(username="alice", display_name="Alice", access_token="alice_token"),
        SeedAccount(username="bob", display_name="Bob", access_token="bob_token"),
        # A locked account: follows require approval.
        SeedAccount(username="carol", locked=True, access_token="carol_token"),
        # A "remote" account (has a domain) for @user@domain mention tests.
        # No token → not directly logged in.
        SeedAccount(username="dave", domain="remote.example"),
    ],
    follows=[SeedFollow(follower="alice", following="bob")],
)

config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=TEST_SEED)
```

The `access_token` you set is exactly what you pass to `Mastodon(access_token=...)`. An
account without a token exists in the database (so it can be followed, mentioned, searched)
but can't be logged in as.

## Zero-boilerplate fixtures (the easy path)

Install the test extra and the fixtures, context manager, and decorator are available
immediately — no `conftest.py` boilerplate, no readiness loops, no port juggling:

```bash
pip install mastodon_mock[test]
```

The pytest plugin auto-registers (via a `pytest11` entry point), so the fixtures appear with
nothing in your `conftest.py`:

```python
def test_follow(mastodon_mock_server):          # a started MockServer, fresh per test
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.account_verify_credentials().id)
    bob.status_post("hi")
    assert any("hi" in s.content for s in alice.timeline_home())
```

`mastodon_mock_server.client("alice")` looks up the seeded account's token for you, so you
never handle tokens by hand. The default seed provides `alice`, `bob`, `carol`, and a
tokenless remote `dave`.

### Fixtures provided

| Fixture | Scope | Yields | Notes |
| ------------------------ | -------- | ----------------------- | ---------------------------------------------- |
| `mastodon_mock_server` | function | `MockServer` (started) | Fresh in-memory DB + seed per test. Isolated. |
| `mastodon_mock_session` | session | `MockServer` (started) | One server for the whole run. |
| `mastodon_mock_reset` | function | `MockServer` | The session server, `reset()`-ed before each test. |
| `mastodon_mock_client` | function | `Mastodon` | Logged in as the first seeded account. |

### Customising the seed

Per-test, with the `mastodon_mock` marker:

```python
import pytest
from mastodon_mock.config import SeedConfig, SeedAccount

CUSTOM_SEED = SeedConfig(accounts=[SeedAccount(username="zed", access_token="zed_token")])

@pytest.mark.mastodon_mock(seed=CUSTOM_SEED)
def test_with_custom_seed(mastodon_mock_server):
    zed = mastodon_mock_server.client("zed")
    ...
```

Project-wide, by overriding the `mastodon_mock_config` fixture in your `conftest.py`:

```python
# conftest.py — optional, project-wide default seed/config
import pytest
from mastodon_mock.config import MastodonMockConfig, DatabaseConfig

@pytest.fixture()
def mastodon_mock_config():
    return MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=MY_SEED)
```

Precedence: per-test marker > `mastodon_mock_config` fixture > built-in default.

### Context manager and decorator (non-pytest, or moto muscle memory)

For scripts, non-pytest tests, or when a test needs more than one server, use
`mock_mastodon` as a context manager:

```python
from mastodon_mock.testing import mock_mastodon

with mock_mastodon(seed=MY_SEED) as server:
    server.client("alice").status_post("hello")
# server stopped on exit, even on exception
```

Or as a decorator — it injects the started `MockServer` as `mastodon_server`:

```python
@mock_mastodon(seed=MY_SEED)
def test_thing(mastodon_server):
    mastodon_server.client("alice").status_post("hi")
```

`mock_mastodon` is dual-use, exactly like moto's `mock_aws`: bare it's a context manager,
wrapping a function it's a decorator. Pass `@mock_mastodon(inject=False)` to run the body
inside a server without changing the signature.

### The `MockServer` primitive

All three styles funnel through one small handle you can also use directly:

```python
from mastodon_mock.testing import MockServer

server = MockServer(seed=...)        # not yet started
server.start()                       # binds a free port, waits for readiness
server.base_url                      # "http://127.0.0.1:54321"
server.client("alice")               # -> a logged-in Mastodon client
server.client(token="raw_token")     # explicit token
server.reset()                       # POST /api/v1/_mock/reset
server.stop()                        # signals exit, joins the thread
```

`start()`/`stop()` are idempotent and `MockServer` is itself a context manager.

## Hand-rolled fixtures (full control)

If you can't take the `test` extra, or want to own the lifecycle, the patterns below are
exactly what the shipped sugar does under the hood.

### Pattern 1 — a fresh server per test (maximum isolation)

A brand-new in-memory database and seed for every test. Simple and bullet-proof; slightly
slower because the server starts and stops each time.

```python
# conftest.py
import socket, threading, time
from collections.abc import Iterator

import pytest
import uvicorn
from mastodon import Mastodon

from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig, DatabaseConfig
# ... TEST_SEED as defined above ...


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def live_server() -> Iterator[str]:
    config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=TEST_SEED)
    app = create_app(config)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture()
def alice(live_server: str) -> Mastodon:
    return Mastodon(access_token="alice_token", api_base_url=live_server)


@pytest.fixture()
def bob(live_server: str) -> Mastodon:
    return Mastodon(access_token="bob_token", api_base_url=live_server)
```

An OS-assigned free port (`port=0` works too) lets the suite run under `pytest-xdist` in
parallel without collisions.

### Pattern 2 — one shared server, reset between tests (fast)

Start the server once for the whole session and reset its state before each test using the
mock-only reset endpoint. Much faster for large suites.

```python
import httpx2 as httpx
import pytest


@pytest.fixture(scope="session")
def _session_server() -> Iterator[str]:
    # identical to live_server above, but session-scoped
    ...


@pytest.fixture()
def fast_server(_session_server: str) -> str:
    httpx.post(f"{_session_server}/api/v1/_mock/reset").raise_for_status()
    return _session_server


@pytest.fixture()
def alice_fast(fast_server: str) -> Mastodon:
    return Mastodon(access_token="alice_token", api_base_url=fast_server)
```

`POST /api/v1/_mock/reset` drops and recreates every table and re-applies the seed, so each
test starts from the same known state.

## Example tests

### Follow, then see the post on the timeline

```python
def test_follow_then_timeline(alice, bob):
    bob_id = bob.account_verify_credentials().id

    alice.account_follow(bob_id)
    rel = alice.account_relationships(bob_id)[0]
    assert rel.following is True

    bob.status_post("hello from bob")
    home = alice.timeline_home()
    assert any("hello from bob" in s.content for s in home)
```

### Notifications are generated as side effects

```python
def test_favourite_notifies_author(alice, bob):
    post = alice.status_post("notice me")
    bob.status_favourite(post.id)

    notes = alice.notifications()
    assert any(n.type == "favourite" and n.status.id == post.id for n in notes)
```

### Locked accounts produce follow requests

```python
def test_locked_account_follow_request(alice, carol):
    carol_id = carol.account_verify_credentials().id
    alice.account_follow(carol_id)

    rel = alice.account_relationships(carol_id)[0]
    assert rel.requested is True            # pending, not yet following

    req = carol.follow_requests()[0]
    carol.follow_request_authorize(req.id)
    assert alice.account_relationships(carol_id)[0].following is True
```

### Pagination works through Mastodon.py's `PaginatableList`

```python
def test_pagination(alice):
    for i in range(30):
        alice.status_post(f"post {i}")

    first = alice.account_statuses(alice.me().id, limit=10)
    assert len(first) == 10
    second = alice.fetch_next(first)        # follows the Link header
    assert len(second) == 10
    assert {s.id for s in first}.isdisjoint({s.id for s in second})
```

## Exercising the OAuth flows

Most tests should use pre-seeded tokens, but if you're testing login/signup wrappers:

```python
def test_self_service_signup(live_server):
    client_id, client_secret = Mastodon.create_app("my-app", api_base_url=live_server)
    client = Mastodon(client_id=client_id, client_secret=client_secret, api_base_url=live_server)

    token = client.create_account(
        username="newbie", password="hunter2hunter2",
        email="newbie@example.test", agreement=True,
    )
    user = Mastodon(access_token=token, api_base_url=live_server)
    assert user.account_verify_credentials().username == "newbie"
```

See [Authentication](../overview/how-it-works.md#authentication) for which grant types are
supported.

## The dual-suite pattern (mock *and* real)

The mock exists so a consuming project can run the **same** tests against both the mock and
a live Mastodon. Parametrize a `mastodon_client` fixture and gate the real backend behind an
env var so it's skipped by default:

```python
import os
import pytest
from mastodon import Mastodon


@pytest.fixture(params=["mock", "real"])
def mastodon_client(request, mock_server_url):
    if request.param == "mock":
        return Mastodon(access_token="alice_token", api_base_url=mock_server_url)
    if not os.environ.get("RUN_REAL_MASTODON_TESTS"):
        pytest.skip("set RUN_REAL_MASTODON_TESTS=1 to run against a real instance")
    return Mastodon(
        access_token=os.environ["REAL_MASTODON_TOKEN"],
        api_base_url=os.environ["REAL_MASTODON_URL"],
    )


def test_post_and_read_back(mastodon_client):
    status = mastodon_client.status_post("integration test post")
    fetched = mastodon_client.status(status.id)
    assert fetched.content == status.content
    mastodon_client.status_delete(status.id)   # cleanup matters for the real backend
```

Guidelines that keep both legs green:

- **Assert on fields Mastodon.py actually reads** (`status.content`, `status.account.acct`,
  `rel.following`, `isinstance(status.created_at, datetime)`). The mock marks exactly those
  as fully supported.
- **Keep tests cleanup-safe.** `status_delete` followed by `status(id)` raises
  `MastodonNotFoundError` on both backends.
- **Isolate mock-only tests** (anything asserting on `/api/v1/_mock/*` or other
  mock-specific behaviour) in a `tests/mock_only/` directory or behind a marker, so the
  `real` parametrization never collects them.

Run modes:

```bash
pytest                                   # mock only (real tests skipped)
RUN_REAL_MASTODON_TESTS=1 pytest         # both
pytest -m "not mock_only"                # CI against a real server
```

## Gotchas

- **No federation.** Search `resolve=True` behaves like `resolve=False`; "remote" accounts
  exist only if you seed them with a `domain`.
- **Rate limiting and scope enforcement are off by default.** Turn them on in config only
  for tests that specifically exercise them.
- **`:memory:` state is gone when the server stops.** Use a file-backed `path` if you want
  to inspect the database after a run.
- **Stubs vs real behaviour.** Some endpoints return empty/fixed shapes. Check
  [What Is and Isn't Mocked](../reference/coverage.md) before asserting.
