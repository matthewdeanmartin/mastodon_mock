"""Unit tests for the ``mastodon_mock`` CLI dispatch (cli.main and helpers)."""

from __future__ import annotations

import argparse
from typing import Any

import pytest
import uvicorn

from mastodon_mock import cli
from mastodon_mock.__about__ import __version__


def test_version_flag_exits_zero_and_prints_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_no_command_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    cli.main([])
    out = capsys.readouterr().out
    assert "usage" in out.lower()
    assert "serve" in out


def test_serve_command_dispatches_to_serve(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_serve(args: argparse.Namespace) -> None:
        captured["args"] = args

    monkeypatch.setattr(cli, "_serve", fake_serve)
    cli.main(["serve", "--host", "0.0.0.0", "--port", "1234", "--in-memory"])

    args = captured["args"]
    assert args.host == "0.0.0.0"
    assert args.port == 1234
    assert args.in_memory is True


def test_db_command_dispatches_to_db(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_db(args: argparse.Namespace) -> None:
        captured["args"] = args

    monkeypatch.setattr(cli, "_db", fake_db)
    cli.main(["db", "upgrade"])

    assert captured["args"].db_command == "upgrade"


def test_gen_data_api_switch_dispatches_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_gen_data(args: argparse.Namespace) -> None:
        captured["args"] = args

    monkeypatch.setattr(cli, "_gen_data", fake_gen_data)
    cli.main(["gen-data", "--api", "http://127.0.0.1:3000", "--preset", "tiny", "--yes"])

    args = captured["args"]
    assert args.api == "http://127.0.0.1:3000"
    assert args.preset == "tiny"


def test_serve_builds_app_and_runs_uvicorn(monkeypatch: pytest.MonkeyPatch) -> None:
    run_calls: dict[str, Any] = {}
    sentinel_app = object()

    monkeypatch.setattr(cli, "create_app", lambda config: sentinel_app)
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port, **_kw: run_calls.update(app=app, host=host, port=port))

    args = argparse.Namespace(config=None, host="127.0.0.1", port=9999, in_memory=True)
    cli._serve(args)

    assert run_calls["app"] is sentinel_app
    assert run_calls["host"] == "127.0.0.1"
    assert run_calls["port"] == 9999


def test_serve_uses_port_and_host_env_when_flags_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    """A PaaS-injected $PORT/$HOST is honored when no --port/--host flag is given."""
    run_calls: dict[str, Any] = {}

    monkeypatch.setattr(cli, "create_app", lambda config: object())
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port, **_kw: run_calls.update(host=host, port=port))
    monkeypatch.setenv("PORT", "8080")
    monkeypatch.setenv("HOST", "0.0.0.0")

    args = argparse.Namespace(config=None, host=None, port=None, in_memory=True)
    cli._serve(args)

    assert run_calls["host"] == "0.0.0.0"
    assert run_calls["port"] == 8080


def test_serve_flag_beats_env_port(monkeypatch: pytest.MonkeyPatch) -> None:
    """An explicit --port wins over $PORT."""
    run_calls: dict[str, Any] = {}

    monkeypatch.setattr(cli, "create_app", lambda config: object())
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port, **_kw: run_calls.update(port=port))
    monkeypatch.setenv("PORT", "8080")

    args = argparse.Namespace(config=None, host=None, port=1234, in_memory=True)
    cli._serve(args)

    assert run_calls["port"] == 1234


def test_serve_ignores_blank_and_invalid_port_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """A blank or non-integer $PORT falls back to the config default (3000), not a crash."""
    run_calls: dict[str, Any] = {}

    monkeypatch.setattr(cli, "create_app", lambda config: object())
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port, **_kw: run_calls.update(port=port))
    monkeypatch.setenv("PORT", "not-a-number")

    args = argparse.Namespace(config=None, host=None, port=None, in_memory=True)
    cli._serve(args)

    assert run_calls["port"] == 3000


def test_serve_demo_applies_rich_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_create_app(config: Any) -> object:
        captured["config"] = config
        return object()

    monkeypatch.setattr(cli, "create_app", fake_create_app)
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)

    args = argparse.Namespace(config=None, host=None, port=None, in_memory=True, demo=True)
    cli._serve(args)

    config = captured["config"]
    assert config.rules  # demo rules applied
    assert config.terms_of_service  # demo ToS applied
    assert len(config.seed.accounts) > 1  # demo community, not the minimal default


def test_serve_in_memory_overrides_database_path(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def fake_create_app(config: Any) -> object:
        captured["path"] = config.database.path
        return object()

    monkeypatch.setattr(cli, "create_app", fake_create_app)
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)

    args = argparse.Namespace(config=None, host=None, port=None, in_memory=True)
    cli._serve(args)

    assert captured["path"] == ":memory:"


def test_db_upgrade_invokes_alembic(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    import alembic.command as alembic_command

    upgrade_calls: dict[str, Any] = {}
    monkeypatch.setattr(alembic_command, "upgrade", lambda cfg, rev: upgrade_calls.update(rev=rev))

    args = argparse.Namespace(db_command="upgrade", config=None)
    cli._db(args)

    assert upgrade_calls["rev"] == "head"
    assert "upgraded" in capsys.readouterr().out.lower()
