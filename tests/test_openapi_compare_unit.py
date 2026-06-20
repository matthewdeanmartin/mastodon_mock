"""Unit tests for the OpenAPI comparison engine and its CLI subcommand."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mastodon_mock import cli
from mastodon_mock import openapi_compare as oc


def _spec(paths: dict, *, title: str = "t", version: str = "1") -> dict:
    return {"openapi": "3.1.0", "info": {"title": title, "version": version}, "paths": paths}


def test_normalize_path_collapses_param_names() -> None:
    assert oc.normalize_path("/api/v1/accounts/{account_id}") == "/api/v1/accounts/{}"
    assert oc.normalize_path("/a/{x}/b/{y}") == "/a/{}/b/{}"
    assert oc.normalize_path("/no/params") == "/no/params"


def test_operation_set_ignores_non_methods() -> None:
    spec = _spec({"/x": {"get": {}, "post": {}, "parameters": [], "summary": "ignored"}})
    assert oc.operation_set(spec) == {("GET", "/x"), ("POST", "/x")}


def test_compare_specs_classifies_drift() -> None:
    truth = _spec(
        {
            "/api/v1/accounts/{id}": {"get": {}},
            "/api/v1/only_truth": {"get": {}},
        }
    )
    mock = _spec(
        {
            "/api/v1/accounts/{account_id}": {"get": {}},  # same op, different param name
            "/api/v1/_mock/reset": {"post": {}},  # allow-listed prefix
            "/api/v1/extra": {"get": {}},  # genuine mock-only
        }
    )
    report = oc.compare_specs(truth, mock)
    assert ("GET", "/api/v1/accounts/{}") in report.common
    assert ("GET", "/api/v1/only_truth") in report.truth_only
    assert ("GET", "/api/v1/extra") in report.mock_only
    assert ("POST", "/api/v1/_mock/reset") in report.mock_only_ignored
    assert report.has_unexpected_drift


def test_required_query_param_mismatch_detected() -> None:
    truth = _spec({"/x": {"get": {"parameters": [{"name": "q", "in": "query", "required": True}]}}})
    mock = _spec({"/x": {"get": {"parameters": []}}})
    report = oc.compare_specs(truth, mock)
    assert len(report.param_diffs) == 1
    assert report.param_diffs[0].missing_in_mock == {"q"}


def test_renderers_produce_output() -> None:
    truth = _spec({"/x": {"get": {}}})
    mock = _spec({"/x": {"get": {}}, "/y": {"get": {}}})
    report = oc.compare_specs(truth, mock)
    assert "shared operations" in oc.render_text(report)
    assert "# OpenAPI contract comparison" in oc.render_markdown(report)
    payload = json.loads(oc.render_json(report))
    assert payload["counts"]["common"] == 1


def test_load_spec_handles_utf8(tmp_path: Path) -> None:
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"openapi": "3.1.0", "paths": {"/x—y": {}}}), encoding="utf-8")
    spec = oc.load_spec(p)
    assert "/x—y" in spec["paths"]


def test_cli_compare_openapi_text(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    truth = tmp_path / "truth.json"
    truth.write_text(json.dumps(_spec({"/api/v1/instance": {"get": {}}})), encoding="utf-8")
    cli.main(["compare-openapi", "--truth", str(truth)])
    out = capsys.readouterr().out
    assert "shared operations" in out


def test_cli_compare_openapi_strict_exits_nonzero(tmp_path: Path) -> None:
    # An upstream-only endpoint the mock can't have -> unexpected drift -> exit 1.
    truth = tmp_path / "truth.json"
    truth.write_text(json.dumps(_spec({"/api/v1/totally_made_up": {"get": {}}})), encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        cli.main(["compare-openapi", "--truth", str(truth), "--strict"])
    assert exc.value.code == 1


def test_cli_compare_openapi_writes_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    truth = tmp_path / "truth.json"
    truth.write_text(json.dumps(_spec({"/api/v1/instance": {"get": {}}})), encoding="utf-8")
    out = tmp_path / "report.md"
    cli.main(["compare-openapi", "--truth", str(truth), "--format", "markdown", "--out", str(out)])
    assert out.exists()
    assert "# OpenAPI contract comparison" in out.read_text(encoding="utf-8")
    assert "Wrote markdown report" in capsys.readouterr().out
