"""Regression coverage for installed CLI migrations and browser-facing origins."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from mastodon_mock import cli
from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig


@pytest.mark.parametrize("initialize_with_migrations", [False, True])
def test_db_upgrade_outside_checkout_uses_config_and_preserves_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, initialize_with_migrations: bool
) -> None:
    """A consumer needs only a mock config, even when its database path contains percent signs."""
    monkeypatch.chdir(tmp_path)
    config_file = tmp_path / "mock.toml"
    config_file.write_text("[database]\npath = 'customer 100%.sqlite'\n", encoding="utf-8")

    if initialize_with_migrations:
        cli.main(["db", "upgrade", "--config", str(config_file)])
    config = MastodonMockConfig.load(config_file)
    with TestClient(create_app(config)) as client:
        response = client.post(
            "/api/v1/statuses", json={"status": "survives migration"}, headers={"Authorization": "Bearer mock_token"}
        )
        assert response.status_code == 200
        status_id = response.json()["id"]

    cli.main(["db", "upgrade", "--config", str(config_file)])
    with TestClient(create_app(config)) as client:
        assert "survives migration" in client.get(f"/api/v1/statuses/{status_id}").json()["content"]
    engine = create_engine(f"sqlite:///{tmp_path / 'customer 100%.sqlite'}")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    engine.dispose()
    assert not (tmp_path / "mastodon_mock.db").exists()


def test_db_upgrade_rejects_ephemeral_target(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Migrating a throwaway database should not claim a durable upgrade."""
    monkeypatch.chdir(tmp_path)
    with pytest.raises(SystemExit, match="file-backed"):
        cli.main(["db", "upgrade"])
    assert not list(tmp_path.glob("*.db"))


def test_db_upgrade_refuses_to_guess_unversioned_schema(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A mismatched unversioned database is left intact rather than stamped blindly."""
    monkeypatch.chdir(tmp_path)
    config_file = tmp_path / "mock.toml"
    config_file.write_text("[database]\npath = 'unknown.sqlite'\n", encoding="utf-8")
    engine = create_engine(f"sqlite:///{tmp_path / 'unknown.sqlite'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE notes (body TEXT)"))
        connection.execute(text("INSERT INTO notes VALUES ('keep me')"))
    with pytest.raises(SystemExit, match="migration baseline"):
        cli.main(["db", "upgrade", "--config", str(config_file)])
    with engine.connect() as connection:
        assert connection.execute(text("SELECT body FROM notes")).scalar_one() == "keep me"
        assert connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).scalars().all() == [
            "notes"
        ]
    engine.dispose()


@pytest.mark.parametrize("tls", [False, True])
def test_serve_infers_public_scheme(tls: bool, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Listener transport determines generated URLs unless a proxy scheme is configured."""
    monkeypatch.chdir(tmp_path)
    captured: list[MastodonMockConfig] = []
    monkeypatch.setattr(cli, "create_app", captured.append)
    monkeypatch.setattr(cli.uvicorn, "run", lambda *args, **kwargs: None)
    args = ["serve", "--host", "127.0.0.1", "--port", "8765"]
    if tls:
        args += ["--ssl-certfile", "test.pem", "--ssl-keyfile", "test.key"]
    cli.main(args)
    assert captured[0].base_url == f"{'https' if tls else 'http'}://localhost:8765"
    assert captured[0].streaming_url == f"{'wss' if tls else 'ws'}://localhost:8765"


def test_serve_preserves_explicit_proxy_scheme(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """HTTPS terminated by a proxy must remain HTTPS in published API links."""
    monkeypatch.chdir(tmp_path)
    config_file = tmp_path / "mock.toml"
    config_file.write_text("domain = 'mock.example'\nurl_scheme = 'https'\n", encoding="utf-8")
    captured: list[MastodonMockConfig] = []
    monkeypatch.setattr(cli, "create_app", captured.append)
    monkeypatch.setattr(cli.uvicorn, "run", lambda *args, **kwargs: None)
    cli.main(["serve", "--config", str(config_file)])
    assert captured[0].base_url == "https://mock.example"


@pytest.mark.parametrize("scheme", ["http", "https"])
def test_generated_assets_use_public_scheme(scheme: Literal["http", "https"]) -> None:
    """The account and instance image URLs load using the configured browser transport."""
    config = MastodonMockConfig(domain="testserver", url_scheme=scheme)
    with TestClient(create_app(config), base_url=f"{scheme}://testserver") as client:
        account = client.get(
            "/api/v1/accounts/verify_credentials", headers={"Authorization": "Bearer mock_token"}
        ).json()
        instance = client.get("/api/v2/instance").json()
        urls = [account["avatar"], account["header"], instance["thumbnail"]["url"]]
        for url in urls:
            assert url.startswith(f"{scheme}://testserver/")
            asset = client.get(url)
            assert asset.status_code == 200
            assert "image/" in asset.headers["content-type"]
        assert instance["configuration"]["urls"]["streaming"] == f"{'ws' if scheme == 'http' else 'wss'}://testserver"
        status = client.post(
            "/api/v1/statuses", json={"status": "#release"}, headers={"Authorization": "Bearer mock_token"}
        ).json()
        assert status["url"].startswith(f"{scheme}://testserver/")
        assert status["tags"][0]["url"].startswith(f"{scheme}://testserver/")
