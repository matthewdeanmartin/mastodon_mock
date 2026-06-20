"""Phase 2 contract guard rail: the mock's OpenAPI must not drift from the upstream
Mastodon ground-truth schema except where ``tests/openapi/allowlist.py`` records it.

See ``spec/openapi_support.md``. The point is a *ratchet*: new accidental endpoints,
newly-discovered unimplemented upstream endpoints, and required-param disagreements all
fail the build until a human reviews them and either fixes the mock or records the
intended divergence with a reason.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from mastodon_mock import openapi_compare as oc
from mastodon_mock.app import create_app
from tests.openapi import allowlist

TRUTH_PATH = Path(__file__).resolve().parent.parent / "mastodon-openapi" / "dist" / "schema.json"


@pytest.fixture(scope="module")
def truth_spec() -> dict:
    if not TRUTH_PATH.exists():
        pytest.skip(f"upstream schema not vendored at {TRUTH_PATH}")
    return oc.load_spec(TRUTH_PATH)


@pytest.fixture(scope="module")
def mock_spec() -> dict:
    return create_app().openapi()


@pytest.fixture(scope="module")
def report(truth_spec: dict, mock_spec: dict) -> oc.ComparisonReport:
    return oc.compare_specs(truth_spec, mock_spec)


def test_both_specs_are_openapi_31(truth_spec: dict, mock_spec: dict) -> None:
    assert truth_spec.get("openapi", "").startswith("3.1"), truth_spec.get("openapi")
    assert mock_spec.get("openapi", "").startswith("3.1"), mock_spec.get("openapi")
    for spec in (truth_spec, mock_spec):
        assert isinstance(spec.get("paths"), dict) and spec["paths"], "spec has no paths"
        assert isinstance(spec.get("info"), dict)


def test_no_unexpected_mock_only_operations(report: oc.ComparisonReport) -> None:
    """Every mock-only operation must be recorded in the allow-list."""
    unexpected = sorted(op for op in report.mock_only if op not in allowlist.MOCK_ONLY)
    assert not unexpected, (
        "Mock serves operations absent from upstream and not in tests/openapi/allowlist.py "
        f"(MOCK_ONLY): {unexpected}. Either remove the route or add it with a reason."
    )


def test_no_unrecorded_truth_only_operations(report: oc.ComparisonReport) -> None:
    """Every unimplemented upstream operation must be recorded in the backlog."""
    unrecorded = sorted(op for op in report.truth_only if op not in allowlist.TRUTH_ONLY)
    assert not unrecorded, (
        "Upstream endpoints the mock does not implement and that are not recorded in "
        f"tests/openapi/allowlist.py (TRUTH_ONLY): {unrecorded}. Implement them or record them."
    )


def test_allowlist_has_no_stale_entries(report: oc.ComparisonReport) -> None:
    """Allow-list entries that no longer correspond to real drift should be deleted,
    so the ratchet keeps tightening as the mock and upstream converge."""
    stale_mock_only = sorted(set(allowlist.MOCK_ONLY) - report.mock_only)
    stale_truth_only = sorted(set(allowlist.TRUTH_ONLY) - report.truth_only)
    assert not stale_mock_only, f"Stale MOCK_ONLY allow-list entries (no longer mock-only): {stale_mock_only}"
    assert not stale_truth_only, (
        f"Stale TRUTH_ONLY allow-list entries (now implemented or removed upstream): {stale_truth_only}. "
        "Delete them and lower MAX_TRUTH_ONLY."
    )


def test_truth_only_backlog_only_shrinks(report: oc.ComparisonReport) -> None:
    """Coverage ratchet: the unimplemented-endpoint backlog must not grow past the cap."""
    assert len(report.truth_only) <= allowlist.MAX_TRUTH_ONLY, (
        f"Unimplemented backlog grew to {len(report.truth_only)} (cap {allowlist.MAX_TRUTH_ONLY}). "
        "Implement endpoints or, if intentional, raise MAX_TRUTH_ONLY with justification."
    )


def test_shared_operations_agree_on_required_params(report: oc.ComparisonReport) -> None:
    """Shared operations must require the same query params as upstream, except where
    a mismatch is explicitly allow-listed."""
    unexpected = sorted(d.operation for d in report.param_diffs if d.operation not in allowlist.PARAM_MISMATCH_ALLOW)
    assert not unexpected, (
        "Shared operations disagree with upstream on required query params and are not in "
        f"PARAM_MISMATCH_ALLOW: {unexpected}."
    )
