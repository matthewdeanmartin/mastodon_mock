"""Verify instance-info routes for both pinned Mastodon versions."""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator

import pytest
import uvicorn
from mastodon import Mastodon

from mastodon_mock.app import create_app
from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig
from mastodon_mock.versioning import CURRENT_VERSION, PREVIOUS_VERSION, api_version_for


def _free_port() -> int:
    """Return an OS-assigned free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(params=[CURRENT_VERSION, PREVIOUS_VERSION])
def versioned_server(request: pytest.FixtureRequest) -> Iterator[tuple[str, str]]:
    """A live server pinned to each tested Mastodon version."""
    version = request.param
    config = MastodonMockConfig(
        mocked_version=version,
        database=DatabaseConfig(path=":memory:"),
        seed=SeedConfig(accounts=[SeedAccount(username="v", access_token="v_token")]),
    )
    app = create_app(config)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}", version
    server.should_exit = True
    thread.join(timeout=5)


def test_reported_version(versioned_server: tuple[str, str]) -> None:
    base_url, version = versioned_server
    client = Mastodon(access_token="v_token", api_base_url=base_url)
    info = client.instance()
    assert info.version == version

    info_v2 = client.instance_v2()
    assert info_v2.api_versions["mastodon"] == api_version_for(version)
