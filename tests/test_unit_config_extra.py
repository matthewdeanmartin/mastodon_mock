from __future__ import annotations

from pathlib import Path

import pytest

from mastodon_mock.config import PRESETS, MastodonMockConfig, SampleDataConfig


def test_config_load_automatic_discovery_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    toml = tmp_path / ".mastodon_mock.toml"
    toml.write_text('domain = "discovery.test"')

    config = MastodonMockConfig.load()
    assert config.domain == "discovery.test"


def test_config_load_from_pyproject(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text('[tool.mastodon_mock]\ndomain = "pyproject.test"\ntitle = "Pyproject Title"\n')

    config = MastodonMockConfig.load()
    assert config.domain == "pyproject.test"
    assert config.title == "Pyproject Title"


def test_config_load_no_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    config = MastodonMockConfig.load()
    assert config.domain == "mock.local"  # default


def test_sample_data_presets() -> None:
    for _name, config in PRESETS.items():
        assert isinstance(config, SampleDataConfig)
        assert config.accounts > 0


def test_config_with_explicit_none_path() -> None:
    config = MastodonMockConfig.load(None)
    assert config.domain == "mock.local"
