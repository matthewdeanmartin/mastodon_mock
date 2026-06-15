"""Dual-backend integration fixtures: same tests run against the mock and a real server.

This suite is the realization of spec/06-testing.md §2 ("Using mastodon_mock in a
consuming project's dual suite"), kept *inside this repo* so we continuously prove
the mock behaves like a real Mastodon for the read surface Mastodon.py exercises.

Both backends are driven through a **web endpoint** (a running HTTP server), never
by talking to the FastAPI app in-process. The ``mastodon_client`` fixture is
parametrized over two backends:

* ``mock`` — a uvicorn server this fixture starts on a free port (always runs).
* ``real`` — a live Mastodon read from ``../mastodon_is_my_blog/.env`` credentials.
  **Only runs when ``RUN_REAL_MASTODON_TESTS=1``**, and every test here is
  **read-only** so it is safe to point at a real account.

Run modes::

    uv run pytest tests/integration                         # mock backend only
    RUN_REAL_MASTODON_TESTS=1 uv run pytest tests/integration  # mock + real
"""

from __future__ import annotations

import os
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

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
    SeedStatus,
)

# A seed rich enough for read-only assertions: an account with a couple of
# statuses and a follow edge so the home timeline is non-empty.
INTEGRATION_SEED = SeedConfig(
    accounts=[
        SeedAccount(username="alice", display_name="Alice", access_token="alice_token"),
        SeedAccount(username="bob", display_name="Bob", access_token="bob_token"),
    ],
    follows=[SeedFollow(follower="alice", following="bob")],
    statuses=[
        SeedStatus(account="bob", text="hello from the seed"),
        SeedStatus(account="bob", text="a second seed post"),
    ],
)

_REAL_ENV_PATH = Path(__file__).resolve().parents[3] / "mastodon_is_my_blog" / ".env"


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Auto-mark everything in this package ``integration`` so it is opt-in.

    The default test run excludes ``integration`` (see ``addopts`` in
    pyproject.toml), so this suite only runs via the dedicated make targets or an
    explicit ``-m integration`` / path selection.
    """
    here = Path(__file__).resolve().parent
    for item in items:
        try:
            in_pkg = here in Path(str(item.fspath)).resolve().parents
        except (OSError, ValueError):
            in_pkg = False
        if in_pkg:
            item.add_marker(pytest.mark.integration)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _parse_env_file(path: Path) -> dict[str, str]:
    """Parse a shell-style ``export KEY=value`` .env file (no shell evaluation)."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def _real_credentials() -> tuple[str, str] | None:
    """Return ``(base_url, access_token)`` for the real server, env-vars taking precedence."""
    base = os.environ.get("REAL_MASTODON_URL")
    token = os.environ.get("REAL_MASTODON_TOKEN")
    if base and token:
        return base, token
    env = _parse_env_file(_REAL_ENV_PATH)
    base = env.get("MASTODON_BASE_URL")
    token = env.get("MASTODON_ACCESS_TOKEN")
    if base and token:
        return base, token
    return None


@pytest.fixture(scope="session")
def mock_server() -> Iterator[str]:
    """A session-scoped uvicorn server backed by the integration seed."""
    config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=INTEGRATION_SEED)
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


@pytest.fixture(params=["mock", "real"])
def mastodon_client(request: pytest.FixtureRequest, mock_server: str) -> Mastodon:
    """A Mastodon client pointed at either the mock or a real server.

    The ``real`` parametrization is skipped unless ``RUN_REAL_MASTODON_TESTS`` is
    set and credentials are resolvable; it is marked ``real_server`` so a CI job
    can select/deselect it.
    """
    if request.param == "mock":
        return Mastodon(access_token="alice_token", api_base_url=mock_server)

    request.node.add_marker(pytest.mark.real_server)
    if not os.environ.get("RUN_REAL_MASTODON_TESTS"):
        pytest.skip("set RUN_REAL_MASTODON_TESTS=1 to run against a real Mastodon instance")
    creds = _real_credentials()
    if creds is None:
        pytest.skip(f"no real credentials (set REAL_MASTODON_URL/REAL_MASTODON_TOKEN or {_REAL_ENV_PATH})")
    base, token = creds
    return Mastodon(access_token=token, api_base_url=base)
