"""Reviewed allow-list of intended divergence between the mock's OpenAPI contract
and the upstream Mastodon ground-truth schema (``mastodon-openapi/dist/schema.json``).

This is the Phase 2 guard rail from ``spec/openapi_support.md``. The contract test
(``tests/test_openapi_contract.py``) fails when drift appears that is *not* recorded
here — so a new accidental endpoint, or a new unimplemented upstream endpoint, breaks
the build until a human reviews it and either fixes the mock or records the divergence
with a reason.

Operations are ``(METHOD, normalized_path)`` where path params are collapsed to ``{}``
(see ``mastodon_mock.openapi_compare.normalize_path``).

The spec proposed a TOML file; we use a plain Python module instead so the allow-list is
dependency-free and works on Python 3.10 (no ``tomllib``), and so each entry can carry an
inline reason next to it.

## The coverage ratchet

``TRUTH_ONLY`` is the backlog of real Mastodon endpoints the mock does not implement.
As endpoints get implemented, delete their entry here — the test will then *fail* if a
deleted-but-still-unimplemented endpoint reappears, and ``MAX_TRUTH_ONLY`` caps the
backlog so it can only shrink. To intentionally implement one, remove it from both the
mock-gap reality and this list in the same change.
"""

from __future__ import annotations

# Operations the mock serves intentionally that upstream Mastodon does not have.
# Keyed by reason so the intent is reviewable in diffs.
MOCK_ONLY: dict[tuple[str, str], str] = {
    ("GET", "/"): "landing page / SPA redirect, not part of the API contract",
    ("GET", "/nodeinfo/2.0"): "NodeInfo discovery; real instances serve it but it's not in the Mastodon API schema",
    # Trailing-slash duplicates FastAPI registers alongside the canonical no-slash route.
    ("GET", "/api/v1/conversations/"): "trailing-slash variant of /api/v1/conversations",
    ("GET", "/api/v1/instance/"): "trailing-slash variant of /api/v1/instance",
    ("GET", "/api/v2/instance/"): "trailing-slash variant of /api/v2/instance",
    ("POST", "/api/v1/reports/"): "trailing-slash variant of /api/v1/reports",
    # Endpoints the schema models under a different version/shape than the mock serves.
    ("GET", "/api/v1/search"): "mock serves v1 search; upstream schema only models /api/v2/search",
    ("GET", "/api/v1/instance/languages"): "instance languages helper not in the pinned upstream schema",
    ("GET", "/api/v1/trends"): "trends index alias; upstream models /api/v1/trends/{tags,statuses,links}",
    ("GET", "/api/v1/streaming"): "streaming handshake endpoint, modeled differently upstream (WS)",
    ("GET", "/api/v1/notifications/policy"): "notification policy endpoint not in pinned upstream schema",
    ("PATCH", "/api/v1/notifications/policy"): "notification policy update not in pinned upstream schema",
    ("POST", "/oauth/authorize"): "mock accepts POST to the authorize endpoint for test convenience",
}

# Real Mastodon operations the mock does not implement yet (coverage backlog).
# Empty: the full truth-only backlog from spec/openapi_compare_report.md has been
# implemented (push subscriptions, profile, filters keywords v2, collections,
# annual reports, async refreshes, oembed, identity_proofs, etc. — see
# spec/03-api-coverage.md for what each became (Full/Static/Stub)).
TRUTH_ONLY: dict[tuple[str, str], str] = {}

# Coverage ratchet: the unimplemented backlog can only shrink. Lower this when you
# implement an endpoint and remove its TRUTH_ONLY entry.
MAX_TRUTH_ONLY = len(TRUTH_ONLY)

# Shared operations whose *required* query params legitimately differ from upstream.
# Value is a short reason. These are reviewed exceptions to the param-conformance check.
PARAM_MISMATCH_ALLOW: dict[tuple[str, str], str] = {}
