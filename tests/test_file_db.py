"""Exercise the file-backed SQLite path at least once."""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
import uvicorn
from mastodon import Mastodon

from mastodon_mock.app import create_app
from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig


def _free_port() -> int:
    """Return an OS-assigned free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture()
def file_server(tmp_path: Path) -> Iterator[str]:
    """A live server backed by a real SQLite file."""
    db_path = tmp_path / "mock.db"
    config = MastodonMockConfig(
        database=DatabaseConfig(path=str(db_path)),
        seed=SeedConfig(accounts=[SeedAccount(username="filer", access_token="filer_token")]),
    )
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


def test_file_db_write_read(file_server: str) -> None:
    client = Mastodon(access_token="filer_token", api_base_url=file_server)
    status = client.status_post("persisted to a file")
    assert client.status(status.id).content == "<p>persisted to a file</p>"
