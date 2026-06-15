"""The pytest plugin: fixtures + the ``mastodon_mock`` marker.

Auto-registered via the ``pytest11`` entry point (see ``pyproject.toml``), so
installing ``mastodon_mock[test]`` makes these fixtures available with no
``pytest_plugins`` line.

Fixtures provided:

================================  ========  ===============================
Fixture                           Scope     Yields
================================  ========  ===============================
``mastodon_mock_server``          function  started :class:`MockServer`
``mastodon_mock_session``         session   started :class:`MockServer`
``mastodon_mock_reset``           function  the session server, reset()
``mastodon_mock_client``          function  a logged-in ``Mastodon``
================================  ========  ===============================

Config/seed precedence: per-test ``@pytest.mark.mastodon_mock`` marker >
``mastodon_mock_config`` fixture (if the project defines one) > built-in default.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import TYPE_CHECKING

import pytest

from mastodon_mock.config import MastodonMockConfig, SeedConfig
from mastodon_mock.testing.server import MockServer

if TYPE_CHECKING:
    from mastodon import Mastodon


def pytest_configure(config: pytest.Config) -> None:
    """Register the ``mastodon_mock`` marker to avoid PytestUnknownMarkWarning."""
    config.addinivalue_line(
        "markers",
        "mastodon_mock(config=..., seed=...): configure the mastodon_mock test " "server for this test.",
    )


@pytest.fixture
def mastodon_mock_config() -> MastodonMockConfig | None:
    """Project-wide default config/seed override.

    Returns ``None`` by default (use the built-in default). A consuming project
    overrides this in its ``conftest.py`` to supply a project-wide seed/config.
    """
    return None


def _resolve_overrides(
    request: pytest.FixtureRequest,
    base_config: MastodonMockConfig | None,
) -> tuple[MastodonMockConfig | None, SeedConfig | None]:
    """Resolve config/seed for a test, honouring the per-test marker."""
    config = base_config
    seed: SeedConfig | None = None
    marker = request.node.get_closest_marker("mastodon_mock")
    if marker is not None:
        if "config" in marker.kwargs:
            config = marker.kwargs["config"]
        if "seed" in marker.kwargs:
            seed = marker.kwargs["seed"]
    # A marker seed overrides the base config (per the precedence rule); pass only
    # one of config/seed to MockServer.
    if seed is not None:
        return None, seed
    return config, None


@pytest.fixture
def mastodon_mock_server(
    request: pytest.FixtureRequest,
    mastodon_mock_config: MastodonMockConfig | None,
) -> Iterator[MockServer]:
    """A fresh, started server (in-memory DB + seed) per test. Maximum isolation."""
    config, seed = _resolve_overrides(request, mastodon_mock_config)
    with MockServer(config=config, seed=seed) as server:
        yield server


@pytest.fixture(scope="session")
def mastodon_mock_session() -> Iterator[MockServer]:
    """One started server shared across the whole test session.

    Session-scoped, so it cannot read function-scoped overrides; it uses the
    built-in default seed. Pair with :func:`mastodon_mock_reset` for isolation.
    """
    with MockServer() as server:
        yield server


@pytest.fixture
def mastodon_mock_reset(mastodon_mock_session: MockServer) -> MockServer:
    """The session server, ``reset()``-ed before the test. Fast + isolated."""
    mastodon_mock_session.reset()
    return mastodon_mock_session


@pytest.fixture
def mastodon_mock_client(mastodon_mock_server: MockServer) -> Mastodon:
    """A ``Mastodon`` client logged in as the first seeded account."""
    return mastodon_mock_server.client()


# Expose a typed alias so static callers can `from ... import MastodonMockServer`.
__all__ = [
    "mastodon_mock_client",
    "mastodon_mock_config",
    "mastodon_mock_reset",
    "mastodon_mock_server",
    "mastodon_mock_session",
    "pytest_configure",
]
