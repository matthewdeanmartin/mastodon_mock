"""Shared pytest fixtures: a live uvicorn server driven via Mastodon.py."""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator

import httpx
import pytest
import uvicorn
from mastodon import Mastodon

from mastodon_mock.app import create_app
from mastodon_mock.config import (
    DatabaseConfig,
    MastodonMockConfig,
    SeedAccount,
    SeedConfig,
    SeedFollow,
)

TEST_SEED = SeedConfig(
    accounts=[
        SeedAccount(username="alice", display_name="Alice", access_token="alice_token"),
        SeedAccount(username="bob", display_name="Bob", access_token="bob_token"),
        SeedAccount(username="carol", display_name="Carol", locked=True, access_token="carol_token"),
        # A "remote" account (has a domain) used to exercise @user@domain mention
        # resolution and domain-block relationships. No token: not directly logged in.
        SeedAccount(username="dave", display_name="Dave", domain="remote.example"),
    ],
    follows=[SeedFollow(follower="alice", following="bob")],
)


def _free_port() -> int:
    """Return an OS-assigned free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _start_server() -> Iterator[str]:
    """Start a uvicorn server on a free port with the shared TEST_SEED; yield its URL."""
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
def live_server() -> Iterator[str]:
    """Function-scoped server: a brand-new in-memory DB + seed per test (full isolation)."""
    yield from _start_server()


# --- Session-scoped variant (spec/07 pattern 2): one server for the whole run,
# state reset between tests via the mock-only /api/v1/_mock/reset endpoint. Much
# faster for large suites; opt in by depending on ``fast_server`` instead of
# ``live_server`` (or the alice_fast/bob_fast/carol_fast clients). ---


@pytest.fixture(scope="session")
def _session_server() -> Iterator[str]:
    """One uvicorn server shared across the whole test session."""
    yield from _start_server()


@pytest.fixture()
def fast_server(_session_server: str) -> str:
    """The session server, reset to seed state before each test that uses it."""
    resp = httpx.post(f"{_session_server}/api/v1/_mock/reset")
    resp.raise_for_status()
    return _session_server


@pytest.fixture()
def alice(live_server: str) -> Mastodon:
    """A Mastodon client logged in as alice."""
    return Mastodon(access_token="alice_token", api_base_url=live_server)


@pytest.fixture()
def bob(live_server: str) -> Mastodon:
    """A Mastodon client logged in as bob."""
    return Mastodon(access_token="bob_token", api_base_url=live_server)


@pytest.fixture()
def carol(live_server: str) -> Mastodon:
    """A Mastodon client logged in as carol (a locked account)."""
    return Mastodon(access_token="carol_token", api_base_url=live_server)


@pytest.fixture()
def alice_fast(fast_server: str) -> Mastodon:
    """alice client bound to the reset session server (fast suites)."""
    return Mastodon(access_token="alice_token", api_base_url=fast_server)


@pytest.fixture()
def bob_fast(fast_server: str) -> Mastodon:
    """bob client bound to the reset session server (fast suites)."""
    return Mastodon(access_token="bob_token", api_base_url=fast_server)


@pytest.fixture()
def carol_fast(fast_server: str) -> Mastodon:
    """carol (locked) client bound to the reset session server (fast suites)."""
    return Mastodon(access_token="carol_token", api_base_url=fast_server)
