"""Compare two OpenAPI 3.1.0 documents — the upstream Mastodon "ground truth"
(``mastodon-openapi/dist/schema.json``) and the mock's own published contract
(``app.openapi()`` / ``/openapi.json``) — and report drift.

See ``spec/openapi_support.md`` for the why. The comparison is deliberately
structural and name-insensitive about path parameters: the mock names them
descriptively (``/api/v1/accounts/{account_id}``) where upstream uses ``{id}``,
so a literal string diff would be all noise. We collapse ``{anything}`` to
``{}`` and compare on (method, normalized-path).

This module is pure/deterministic — no live server required to compare two
spec dicts. The CLI (``mastodon_mock compare-openapi``) is responsible for
producing the mock spec from the live app when one isn't supplied on disk.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Operations the mock serves that have no upstream Mastodon equivalent, by design.
# Matched as path *prefixes* against the normalized path. Keep this list curated;
# the Phase 2 allow-list test (tests/test_openapi_contract.py) is the stricter,
# per-operation gate — this is just the coarse default so `compare-openapi` output
# isn't dominated by intentional control-plane/UI routes.
DEFAULT_MOCK_ONLY_PREFIXES: tuple[str, ...] = (
    "/_ui",
    "/_mock",
    "/api/v1/_mock",
    "/api/v2/_mock",
    "/.well-known",
    "/media",
    "/avatars",
    "/headers",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/admin",
    "/api/v2/admin",
)

_PARAM_RE = re.compile(r"\{[^}]+\}")

Operation = tuple[str, str]  # (METHOD, normalized_path)
_HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def load_spec(path: str | Path) -> dict[str, Any]:
    """Load an OpenAPI JSON document, tolerating non-cp1252 bytes on Windows."""
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    return data


def normalize_path(path: str) -> str:
    """Collapse path-template parameters to ``{}`` so ``{id}`` == ``{account_id}``."""
    return _PARAM_RE.sub("{}", path)


def operation_set(spec: dict[str, Any]) -> set[Operation]:
    """Every ``(METHOD, normalized_path)`` operation declared in a spec."""
    ops: set[Operation] = set()
    for path, item in spec.get("paths", {}).items():
        norm = normalize_path(path)
        for method in item:
            if method.lower() in _HTTP_METHODS:
                ops.add((method.upper(), norm))
    return ops


def _is_ignored(op: Operation, prefixes: tuple[str, ...]) -> bool:
    _method, path = op
    return any(path == p or path.startswith(p.rstrip("/") + "/") or path == p.rstrip("/") for p in prefixes)


def _required_params(spec: dict[str, Any], where: str) -> dict[Operation, set[str]]:
    """For every operation, the set of *required* params in location ``where``
    (``"query"`` or ``"path"``), keyed by normalized operation."""
    out: dict[Operation, set[str]] = {}
    for path, item in spec.get("paths", {}).items():
        norm = normalize_path(path)
        shared = item.get("parameters", [])
        for method, op in item.items():
            if method.lower() not in _HTTP_METHODS:
                continue
            names: set[str] = set()
            for param in [*shared, *op.get("parameters", [])]:
                if not isinstance(param, dict):
                    continue
                if param.get("in") == where and param.get("required"):
                    name = param.get("name")
                    if name:
                        names.add(name)
            out[(method.upper(), norm)] = names
    return out


@dataclass
class ParamDiff:
    """A shared operation where required query params disagree between specs."""

    operation: Operation
    missing_in_mock: set[str] = field(default_factory=set)
    extra_in_mock: set[str] = field(default_factory=set)


@dataclass
class ComparisonReport:
    """Result of comparing a truth spec against a mock spec."""

    common: set[Operation]
    mock_only: set[Operation]  # already filtered by the ignore-list
    mock_only_ignored: set[Operation]
    truth_only: set[Operation]
    param_diffs: list[ParamDiff]
    truth_info: dict[str, Any]
    mock_info: dict[str, Any]

    @property
    def has_unexpected_drift(self) -> bool:
        """True when there is drift not explained by the ignore-list."""
        return bool(self.mock_only or self.truth_only or self.param_diffs)


def compare_specs(
    truth: dict[str, Any],
    mock: dict[str, Any],
    *,
    ignore_prefixes: tuple[str, ...] = DEFAULT_MOCK_ONLY_PREFIXES,
) -> ComparisonReport:
    """Compare two OpenAPI documents, returning a structured drift report."""
    truth_ops = operation_set(truth)
    mock_ops = operation_set(mock)

    common = truth_ops & mock_ops
    raw_mock_only = mock_ops - truth_ops
    truth_only = truth_ops - mock_ops

    mock_only = {op for op in raw_mock_only if not _is_ignored(op, ignore_prefixes)}
    mock_only_ignored = raw_mock_only - mock_only

    truth_query = _required_params(truth, "query")
    mock_query = _required_params(mock, "query")
    param_diffs: list[ParamDiff] = []
    for op in sorted(common):
        t = truth_query.get(op, set())
        m = mock_query.get(op, set())
        missing = t - m
        extra = m - t
        if missing or extra:
            param_diffs.append(ParamDiff(operation=op, missing_in_mock=missing, extra_in_mock=extra))

    return ComparisonReport(
        common=common,
        mock_only=mock_only,
        mock_only_ignored=mock_only_ignored,
        truth_only=truth_only,
        param_diffs=param_diffs,
        truth_info=truth.get("info", {}),
        mock_info=mock.get("info", {}),
    )


def _fmt_op(op: Operation) -> str:
    method, path = op
    return f"{method:<6} {path}"


def render_text(report: ComparisonReport) -> str:
    """Human-readable terminal summary."""
    t = report.truth_info
    m = report.mock_info
    lines = [
        f"truth: {t.get('title', '?')} {t.get('version', '?')}",
        f"mock:  {m.get('title', '?')} {m.get('version', '?')}",
        "",
        f"shared operations:        {len(report.common)}",
        f"mock-only (operation-reviewed separately): {len(report.mock_only)}",
        f"mock-only (allow-listed): {len(report.mock_only_ignored)}",
        f"truth-only (unimplemented): {len(report.truth_only)}",
        f"required-param mismatches:  {len(report.param_diffs)}",
    ]
    if report.mock_only:
        lines += ["", "## Mock-only operations requiring per-operation review:"]
        lines += [f"  + {_fmt_op(op)}" for op in sorted(report.mock_only)]
    if report.truth_only:
        lines += ["", "## Truth-only operations (upstream endpoints the mock lacks):"]
        lines += [f"  - {_fmt_op(op)}" for op in sorted(report.truth_only)]
    if report.param_diffs:
        lines += ["", "## Required-param mismatches on shared operations:"]
        for d in report.param_diffs:
            detail = []
            if d.missing_in_mock:
                detail.append(f"missing in mock: {sorted(d.missing_in_mock)}")
            if d.extra_in_mock:
                detail.append(f"extra in mock: {sorted(d.extra_in_mock)}")
            lines.append(f"  ~ {_fmt_op(d.operation)} — {'; '.join(detail)}")
    return "\n".join(lines) + "\n"


def render_markdown(report: ComparisonReport) -> str:
    """Markdown report suitable for committing to ``spec/``."""
    t = report.truth_info
    m = report.mock_info
    lines = [
        "# OpenAPI contract comparison",
        "",
        "Generated by `mastodon_mock compare-openapi`. Do not edit by hand;",
        "regenerate with `make compare-openapi`. See `spec/openapi_support.md`.",
        "",
        f"- **truth**: {t.get('title', '?')} {t.get('version', '?')}",
        f"- **mock**: {m.get('title', '?')} {m.get('version', '?')}",
        "",
        "| metric | count |",
        "| --- | --- |",
        f"| shared operations | {len(report.common)} |",
        f"| mock-only (operation-reviewed separately) | {len(report.mock_only)} |",
        f"| mock-only (allow-listed) | {len(report.mock_only_ignored)} |",
        f"| truth-only (unimplemented) | {len(report.truth_only)} |",
        f"| required-param mismatches | {len(report.param_diffs)} |",
    ]

    def section(title: str, ops: list[str]) -> None:
        lines.extend(["", f"## {title}", ""])
        if ops:
            lines.extend(f"- `{o}`" for o in ops)
        else:
            lines.append("_none_")

    section(
        "Mock-only operations requiring per-operation review",
        [_fmt_op(op) for op in sorted(report.mock_only)],
    )
    section(
        "Truth-only operations (upstream endpoints the mock does not implement)",
        [_fmt_op(op) for op in sorted(report.truth_only)],
    )
    section(
        "Required-param mismatches on shared operations",
        [
            _fmt_op(d.operation)
            + (f" — missing in mock: {sorted(d.missing_in_mock)}" if d.missing_in_mock else "")
            + (f" — extra in mock: {sorted(d.extra_in_mock)}" if d.extra_in_mock else "")
            for d in report.param_diffs
        ],
    )
    section(
        "Allow-listed mock-only operations (control plane / admin / UI)",
        [_fmt_op(op) for op in sorted(report.mock_only_ignored)],
    )
    return "\n".join(lines) + "\n"


def render_json(report: ComparisonReport) -> str:
    """Machine-readable report."""

    def ops(s: set[Operation]) -> list[list[str]]:
        return [list(op) for op in sorted(s)]

    payload = {
        "truth_info": report.truth_info,
        "mock_info": report.mock_info,
        "counts": {
            "common": len(report.common),
            "mock_only": len(report.mock_only),
            "mock_only_ignored": len(report.mock_only_ignored),
            "truth_only": len(report.truth_only),
            "param_diffs": len(report.param_diffs),
        },
        "mock_only": ops(report.mock_only),
        "truth_only": ops(report.truth_only),
        "mock_only_ignored": ops(report.mock_only_ignored),
        "param_diffs": [
            {
                "operation": list(d.operation),
                "missing_in_mock": sorted(d.missing_in_mock),
                "extra_in_mock": sorted(d.extra_in_mock),
            }
            for d in report.param_diffs
        ],
    }
    return json.dumps(payload, indent=2) + "\n"
