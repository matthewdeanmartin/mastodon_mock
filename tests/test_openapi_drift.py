"""Regression tests for structural upstream drift detection."""

import hashlib
import json
from pathlib import Path

from mastodon_mock.openapi_drift import schema_changes


def test_optional_parameter_and_component_changes_are_detected() -> None:
    """Catch drift missed by operation/required-query comparisons."""
    before = {"paths": {"/x": {"get": {"parameters": []}}}, "components": {"schemas": {"X": {"type": "string"}}}}
    after = {
        "paths": {"/x": {"get": {"parameters": [{"name": "filter", "in": "query", "required": False}]}}},
        "components": {"schemas": {"X": {"type": ["string", "null"]}}},
    }
    assert {change["path"] for change in schema_changes(before, after)} == {
        "/paths/~1x/get/parameters",
        "/components/schemas/X/type",
    }


def test_prose_only_changes_are_ignored() -> None:
    """Editorial changes do not trigger maintenance alerts."""
    assert not schema_changes({"description": "old", "type": "string"}, {"description": "new", "type": "string"})


def test_request_response_and_removal_changes_are_detected() -> None:
    """Capture removed requirements and changed response/request structures."""
    before = {"requestBody": {"required": True}, "responses": {"200": {"content": {}}}}
    after = {"requestBody": {}, "responses": {"422": {}}}
    assert len(schema_changes(before, after)) == 3


def test_properties_named_like_documentation_are_not_ignored() -> None:
    """A payload field named description is API structure, not editorial prose."""
    before = {"properties": {"description": {"type": "string"}}}
    after = {"properties": {"description": {"type": ["string", "null"]}}}
    assert schema_changes(before, after)[0]["path"] == "/properties/description/type"


def test_snapshot_provenance_matches_committed_contracts() -> None:
    """Snapshots cannot change silently without updating their reviewed provenance."""
    root = Path(__file__).resolve().parents[1] / "mastodon-openapi"
    provenance = json.loads((root / "provenance.json").read_text(encoding="utf-8"))
    for name, metadata in provenance["snapshots"].items():
        content = (root / name / "schema.json").read_text(encoding="utf-8")
        assert hashlib.sha256(content.encode("utf-8")).hexdigest() == metadata["sha256_lf"]
        assert json.loads(content)["info"] == metadata["info"]
