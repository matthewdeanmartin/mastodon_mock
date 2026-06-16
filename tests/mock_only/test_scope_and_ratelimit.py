"""Opt-in scope enforcement + rate limiting (mock-only; next_phase.md §4 P2).

Both features are off by default; these spin up servers with them enabled and
verify the mock produces the responses Mastodon.py's scope-error and
``ratelimit_method`` handling expect. Mock-only: a real server's limits/scopes
are not controllable from a test.
"""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator

import httpx2 as httpx
import pytest
import uvicorn
from fastapi import FastAPI
from mastodon import Mastodon
from mastodon.errors import MastodonRatelimitError
from sqlalchemy import select

from mastodon_mock.config import (
    AuthConfig,
    DatabaseConfig,
    MastodonMockConfig,
    RateLimitConfig,
    SeedAccount,
    SeedConfig,
)
from mastodon_mock.db.models import Account, OAuthToken, utcnow

pytestmark = pytest.mark.mock_only

_SEED = SeedConfig(
    accounts=[SeedAccount(username="alice", display_name="Alice", access_token="alice_token")],
)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _serve(config: MastodonMockConfig) -> Iterator[tuple[str, FastAPI]]:
    """Start a server for ``config``; yield ``(base_url, app)``."""
    from mastodon_mock.app import create_app

    app = create_app(config)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}", app
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def _issue_token(app: FastAPI, scopes: list[str]) -> str:
    """Insert an OAuth token with the given scopes for alice; return the token string."""
    factory = app.state.session_factory
    with factory() as session:
        alice = session.scalar(select(Account).where(Account.username == "alice"))
        assert alice is not None
        token = OAuthToken(
            access_token=f"scoped_{'_'.join(scopes)}",
            account_id=alice.id,
            scopes=scopes,
            created_at=utcnow(),
        )
        session.add(token)
        session.commit()
        return token.access_token


# --- scope enforcement -------------------------------------------------------


@pytest.fixture()
def scoped_server() -> Iterator[tuple[str, FastAPI]]:
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=_SEED,
        auth=AuthConfig(enforce_scopes=True),
    )
    yield from _serve(config)


def test_read_scope_allows_reads_blocks_writes(scoped_server: tuple[str, FastAPI]) -> None:
    base_url, app = scoped_server
    read_token = _issue_token(app, ["read"])
    client = Mastodon(access_token=read_token, api_base_url=base_url)

    # A read is permitted.
    assert client.account_verify_credentials().username == "alice"

    # A write is rejected with 403 (Mastodon.py surfaces this as an API error).
    with pytest.raises(Exception) as exc:
        client.status_post("should be blocked")
    assert "403" in str(exc.value) or "scope" in str(exc.value).lower()


def test_write_scope_allows_writes(scoped_server: tuple[str, FastAPI]) -> None:
    base_url, app = scoped_server
    rw_token = _issue_token(app, ["read", "write"])
    client = Mastodon(access_token=rw_token, api_base_url=base_url)
    posted = client.status_post("allowed by write scope")
    assert posted.content == "<p>allowed by write scope</p>"


@pytest.fixture()
def default_server() -> Iterator[tuple[str, FastAPI]]:
    config = MastodonMockConfig(database=DatabaseConfig(path=":memory:"), seed=_SEED)
    yield from _serve(config)


def test_disabled_by_default_allows_any_scope(default_server: tuple[str, FastAPI]) -> None:
    # Default config does not enforce scopes: a read-only token can still write.
    base_url, app = default_server
    read_token = _issue_token(app, ["read"])
    client = Mastodon(access_token=read_token, api_base_url=base_url)
    assert client.status_post("writes fine when unenforced").id


# --- rate limiting -----------------------------------------------------------


@pytest.fixture()
def limited_server() -> Iterator[tuple[str, FastAPI]]:
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=_SEED,
        ratelimit=RateLimitConfig(enabled=True, limit=3, window_seconds=300),
    )
    yield from _serve(config)


def test_rate_limit_headers_present(limited_server: tuple[str, FastAPI]) -> None:
    base_url, _ = limited_server
    resp = httpx.get(
        f"{base_url}/api/v1/accounts/verify_credentials",
        headers={"Authorization": "Bearer alice_token"},
    )
    assert resp.status_code == 200
    assert resp.headers["X-RateLimit-Limit"] == "3"
    assert int(resp.headers["X-RateLimit-Remaining"]) == 2
    assert int(resp.headers["X-RateLimit-Reset"]) > 0


def test_rate_limit_429_after_limit(limited_server: tuple[str, FastAPI]) -> None:
    base_url, _ = limited_server
    headers = {"Authorization": "Bearer alice_token"}
    url = f"{base_url}/api/v1/accounts/verify_credentials"
    # limit=3 → 4th request is throttled.
    statuses = [httpx.get(url, headers=headers).status_code for _ in range(4)]
    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429


def test_ratelimit_method_throw_raises(limited_server: tuple[str, FastAPI]) -> None:
    base_url, _ = limited_server
    client = Mastodon(access_token="alice_token", api_base_url=base_url, ratelimit_method="throw")
    with pytest.raises(MastodonRatelimitError):
        for _ in range(10):
            client.account_verify_credentials()
