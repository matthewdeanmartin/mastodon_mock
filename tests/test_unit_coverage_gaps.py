"""Focused unit tests for small branches that contract tests do not cover directly."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from mastodon_mock.config import (
    DEMO_RULES,
    DEMO_SEED,
    DEMO_TERMS_OF_SERVICE,
    MastodonMockConfig,
    SeedAccount,
    SeedConfig,
    demo_config,
)
from mastodon_mock.testing import plugin
from mastodon_mock.versioning import api_version_for, parse_version_string


class Marker:
    """Minimal marker stand-in exposing pytest's ``kwargs`` contract."""

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs


class MarkerNode:
    """Minimal pytest node stand-in for override resolution tests."""

    def __init__(self, marker: Marker | None) -> None:
        self.marker = marker

    def get_closest_marker(self, name: str) -> Marker | None:
        """Return the configured marker when the requested name matches."""
        return self.marker if name == "mastodon_mock" else None


def request_with_marker(marker: Marker | None) -> Any:
    """Build the request shape consumed by the plugin helper."""
    return SimpleNamespace(node=MarkerNode(marker))


def test_explicit_config_path_wins_over_discovered_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".mastodon_mock.toml").write_text('domain = "discovered.test"\n')
    (tmp_path / "pyproject.toml").write_text('[tool.mastodon_mock]\ndomain = "pyproject.test"\n')
    explicit = tmp_path / "explicit.toml"
    explicit.write_text('domain = "explicit.test"\n[server]\nport = 4321\n')

    config = MastodonMockConfig.load(explicit)

    assert config.domain == "explicit.test"
    assert config.server.port == 4321


def test_empty_discovered_config_does_not_fall_through_to_pyproject(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".mastodon_mock.toml").write_text("")
    (tmp_path / "pyproject.toml").write_text('[tool.mastodon_mock]\ndomain = "pyproject.test"\n')

    config = MastodonMockConfig.load()

    assert config.domain == "mock.local"


def test_pyproject_without_mastodon_mock_table_uses_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "pyproject.toml").write_text("[tool.other]\nenabled = true\n")

    config = MastodonMockConfig.load()

    assert config == MastodonMockConfig()


def test_demo_config_copies_base_and_preserves_unrelated_settings() -> None:
    base = MastodonMockConfig(domain="custom.test", rules=["base rule"], terms_of_service="base terms")

    demo = demo_config(base)

    assert demo is not base
    assert demo.domain == "custom.test"
    assert demo.seed == DEMO_SEED
    assert demo.rules == DEMO_RULES
    assert demo.rules is not DEMO_RULES
    assert demo.terms_of_service == DEMO_TERMS_OF_SERVICE
    assert base.rules == ["base rule"]
    assert base.terms_of_service == "base terms"
    assert base.seed.accounts[0].username == "testuser"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.2.3.4", (1, 2, 3)),
        ("01.002.0003", (1, 2, 3)),
        ("v4.4.4", (0, 4, 4)),
        ("4.beta.7", (4, 0, 7)),
        ("4.-2.1", (4, 0, 1)),
    ],
)
def test_parse_version_string_edge_cases(raw: str, expected: tuple[int, int, int]) -> None:
    assert parse_version_string(raw) == expected


@pytest.mark.parametrize(("raw", "expected"), [("4.3.99", 2), ("4.0", 1), ("5.0.0", 2), ("nonsense", 2)])
def test_api_version_for_known_and_unknown_lines(raw: str, expected: int) -> None:
    assert api_version_for(raw) == expected


def test_resolve_overrides_without_marker_returns_base_config() -> None:
    base = MastodonMockConfig(domain="base.test")

    config, seed = plugin._resolve_overrides(request_with_marker(None), base)

    assert config is base
    assert seed is None


def test_resolve_overrides_marker_config_replaces_base() -> None:
    base = MastodonMockConfig(domain="base.test")
    marked = MastodonMockConfig(domain="marked.test")
    marker = Marker(config=marked)

    config, seed = plugin._resolve_overrides(request_with_marker(marker), base)

    assert config is marked
    assert seed is None


def test_resolve_overrides_marker_seed_takes_precedence_over_configs() -> None:
    base = MastodonMockConfig(domain="base.test")
    marked = MastodonMockConfig(domain="marked.test")
    marked_seed = SeedConfig(accounts=[SeedAccount(username="seeded")])
    marker = Marker(config=marked, seed=marked_seed)

    config, seed = plugin._resolve_overrides(request_with_marker(marker), base)

    assert config is None
    assert seed is marked_seed


def test_pytest_configure_registers_marker(mocker: Any) -> None:
    config = mocker.Mock()

    plugin.pytest_configure(config)

    config.addinivalue_line.assert_called_once_with(
        "markers",
        "mastodon_mock(config=..., seed=...): configure the mastodon_mock test server for this test.",
    )


def test_default_config_fixture_returns_none() -> None:
    fixture = plugin.mastodon_mock_config
    assert fixture.__wrapped__() is None  # type: ignore[attr-defined]


def test_reset_fixture_resets_and_returns_session_server(mocker: Any) -> None:
    server = mocker.Mock()

    result = plugin.mastodon_mock_reset.__wrapped__(server)  # type: ignore[attr-defined]

    server.reset.assert_called_once_with()
    assert result is server


def test_client_fixture_returns_default_client(mocker: Any) -> None:
    server = mocker.Mock()
    client = object()
    server.client.return_value = client

    result = plugin.mastodon_mock_client.__wrapped__(server)  # type: ignore[attr-defined]

    server.client.assert_called_once_with()
    assert result is client
