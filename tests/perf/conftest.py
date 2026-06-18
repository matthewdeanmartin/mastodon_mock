"""Fixtures for the performance benchmark suite (spec/09-sample-data-and-perf.md).

These build a ``medium`` cohort once (module-scoped) into a real threaded uvicorn
server and drive read endpoints over loopback. Marked ``slow`` so they're excluded from
the default run.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import uvicorn
from sqlalchemy import func, select

from mastodon_mock.app import create_app
from mastodon_mock.config import PRESETS, DatabaseConfig, MastodonMockConfig, SeedConfig
from mastodon_mock.db.models import OAuthToken, Status
from mastodon_mock.db.sample_data import generate_sample_data

BASELINES_PATH = Path(__file__).parent / "baselines.json"


@dataclass
class PerfWorld:
    """A running server URL plus a token and a heavy account id to query."""

    base_url: str
    token: str
    busy_account_id: str


@pytest.fixture(scope="module")
def perf_world() -> Iterator[PerfWorld]:
    """Create a ``medium`` cohort and serve it over a threaded uvicorn server."""
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=SeedConfig(),  # no default seed account; the cohort is the world
    )
    app = create_app(config)
    cfg = PRESETS["medium"].model_copy(update={"seed": 7})
    generate_sample_data(app.state.engine, cfg)

    with app.state.session_factory() as session:
        token = session.scalar(select(OAuthToken.access_token).order_by(OAuthToken.id))
        busy = session.execute(
            select(Status.account_id, func.count()).group_by(Status.account_id).order_by(func.count().desc()).limit(1)
        ).first()
        assert token and busy is not None
        busy_id = str(busy[0])

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    assert server.started, "perf server failed to start"
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield PerfWorld(base_url=f"http://127.0.0.1:{port}", token=token, busy_account_id=busy_id)
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@pytest.fixture(scope="session")
def baselines() -> dict[str, Any]:
    """Load the committed perf baselines (ratios/ceilings)."""
    result: dict[str, Any] = json.loads(BASELINES_PATH.read_text(encoding="utf-8"))
    return result
