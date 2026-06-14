"""Shared pytest fixtures: a live uvicorn server driven via Mastodon.py."""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator

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
    ],
    follows=[SeedFollow(follower="alice", following="bob")],
)


def _free_port() -> int:
    """Return an OS-assigned free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture()
def live_server() -> Iterator[str]:
    """Spin up a real uvicorn server on a free port and yield its base URL."""
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
