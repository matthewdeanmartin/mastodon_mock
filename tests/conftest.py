"""Shared pytest fixtures, now layered on the shipped ``MockServer`` sugar.

This file dogfoods ``mastodon_mock.testing``: the repo is the first consumer of
its own test-ergonomics sugar. The historical fixture names (``live_server``,
``alice``, ``fast_server``, …) are kept as thin wrappers so existing tests don't
change. The seed matches what those tests assume.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from mastodon import Mastodon

from mastodon_mock.config import (
    SeedAccount,
    SeedConfig,
    SeedFollow,
)
from mastodon_mock.testing import MockServer

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


@pytest.fixture()
def live_server() -> Iterator[str]:
    """Function-scoped server: a brand-new in-memory DB + seed per test (full isolation)."""
    with MockServer(seed=TEST_SEED) as server:
        yield server.base_url


# --- Session-scoped variant (spec/07 pattern 2): one server for the whole run,
# state reset between tests via the mock-only /api/v1/_mock/reset endpoint. Much
# faster for large suites; opt in by depending on ``fast_server`` instead of
# ``live_server`` (or the alice_fast/bob_fast/carol_fast clients). ---


@pytest.fixture(scope="session")
def _session_server() -> Iterator[MockServer]:
    """One uvicorn server shared across the whole test session."""
    with MockServer(seed=TEST_SEED) as server:
        yield server


@pytest.fixture()
def fast_server(_session_server: MockServer) -> str:
    """The session server, reset to seed state before each test that uses it."""
    _session_server.reset()
    return _session_server.base_url


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
