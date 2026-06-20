"""Phase 3 — live OpenAPI fuzzing of the mock against the upstream Mastodon schema.

Loads the ground-truth schema (``mastodon-openapi/dist/schema.json``), boots a real
``MockServer``, and throws Schemathesis-generated requests at every *shared, read-only*
operation, asserting the responses conform to the schema (status code, content type, and
— where the mock returns it — response body shape).

This is **opt-in**: the whole module is marked ``contract`` (deselected by default, see
``pyproject.toml``) and requires the ``contract`` extra (``schemathesis``). Run it with:

    uv sync --extra contract
    uv run pytest -m contract

Why GET-only and shared-only for now? See ``spec/openapi_support.md``: with many
endpoints still unimplemented and handlers returning bare ``dict``/``list`` (no
``response_model``), broad write-path fuzzing would mostly rediscover known gaps. The
*machinery* is what matters here — as endpoints and response shapes land, widen
``_is_fuzz_target`` and shrink ``QUARANTINE``.
"""

from __future__ import annotations

import os

import pytest

from mastodon_mock import openapi_compare as oc
from mastodon_mock.app import create_app
from tests.openapi.allowlist import TRUTH_ONLY

pytestmark = pytest.mark.contract

schemathesis = pytest.importorskip("schemathesis", reason="install the `contract` extra to run OpenAPI fuzzing")

from pathlib import Path  # noqa: E402

import hypothesis  # noqa: E402

from mastodon_mock.testing import MockServer  # noqa: E402

# Bound the fuzzing so the run is CI-tractable across the whole shared GET surface.
# Schemathesis honours hypothesis settings; override with HYPOTHESIS_MAX_EXAMPLES locally
# for a deeper sweep. deadline is disabled because a cold first request to the freshly
# booted server can exceed hypothesis' default per-example deadline.
_MAX_EXAMPLES = int(os.environ.get("HYPOTHESIS_MAX_EXAMPLES", "15"))

TRUTH_PATH = Path(__file__).resolve().parent.parent / "mastodon-openapi" / "dist" / "schema.json"

# The seeded account whose token we authenticate as (see MockServer default seed).
_AUTH_TOKEN = "alice_token"  # nosec B105 - test fixture token, not a secret

# Path prefixes that aren't fuzzable over plain request/response: streaming endpoints are
# Server-Sent-Events — they hold the connection open and never return a normal body, so a
# synchronous fuzz request just blocks until the deadline. Exclude them structurally
# rather than quarantining them as "divergence" (they aren't divergent, they're a
# different transport).
NOT_FUZZABLE_PREFIXES: tuple[str, ...] = ("/api/v1/streaming",)

# Operations that are shared with upstream but known to diverge today. Each entry is a
# ``(METHOD, normalized_path)`` plus a reason. Mirrors the Phase 2 allow-list philosophy:
# don't let known gaps fail the run, but keep them visible and shrinking.
QUARANTINE: dict[tuple[str, str], str] = {
    # Populate as real fuzzing surfaces divergence the mock can't currently match.
}


def _is_fuzzable(op: tuple[str, str]) -> bool:
    _method, path = op
    return not any(path.startswith(prefix) for prefix in NOT_FUZZABLE_PREFIXES)


def _shared_get_operations() -> set[tuple[str, str]]:
    """The set of (GET, normalized_path) operations present in *both* specs — i.e. the
    read-only endpoints the mock claims to implement and upstream documents."""
    truth = oc.load_spec(TRUTH_PATH)
    mock = create_app().openapi()
    report = oc.compare_specs(truth, mock)
    return {op for op in report.common if op[0] == "GET" and _is_fuzzable(op)}


# Computed once at import for the include-filter below.
_SHARED_GET = _shared_get_operations() if TRUTH_PATH.exists() else set()


@pytest.fixture(scope="module")
def server() -> MockServer:
    if not TRUTH_PATH.exists():
        pytest.skip(f"upstream schema not vendored at {TRUTH_PATH}")
    with MockServer() as srv:
        yield srv


def _is_fuzz_target(ctx) -> bool:
    """Include only shared read-only operations that aren't quarantined."""
    op = ctx.operation
    key = (op.method.upper(), oc.normalize_path(op.path))
    return key in _SHARED_GET and key not in QUARANTINE


# Schemathesis' pytest integration parametrizes off a module-scope schema. Paths/methods
# are static, so we can bind the operation set at collection time and pass base_url + auth
# per-call below (the running server's port is only known at fixture time).
_collection_schema = (
    schemathesis.openapi.from_path(TRUTH_PATH).include(_is_fuzz_target) if TRUTH_PATH.exists() else None
)


# Two modes:
#  * default  — hard-assert only "no 5xx". This is a guarantee the mock should *always*
#               meet: generated, schema-valid (and invalid) GETs must never crash it.
#  * strict   — CONTRACT_STRICT=1 also asserts full schema conformance (status code,
#               content type, response body shape). This is the ratchet/reporting mode;
#               it surfaces the (currently many) places the mock's output diverges from
#               the upstream schema. Use it locally and in a dedicated, non-blocking CI
#               job until the gaps are closed (see spec/openapi_support.md, Phase 4).
_STRICT = os.environ.get("CONTRACT_STRICT") == "1"


if _collection_schema is not None:

    @_collection_schema.parametrize()
    @hypothesis.settings(max_examples=_MAX_EXAMPLES, deadline=None)
    def test_mock_conforms_to_upstream_schema(case, server: MockServer) -> None:
        """Generated requests against shared read-only endpoints.

        Always: the mock must not 500. With ``CONTRACT_STRICT=1``: the response must also
        conform to the ground-truth schema (status code, content type, body shape).
        """
        headers = {"Authorization": f"Bearer {_AUTH_TOKEN}"}
        if _STRICT:
            # call_and_validate runs the full default check suite (incl. schema conformance).
            case.call_and_validate(base_url=server.base_url, headers=headers)
        else:
            response = case.call(base_url=server.base_url, headers=headers)
            case.validate_response(
                response,
                checks=[schemathesis.checks.not_a_server_error],
            )


def test_fuzz_targets_are_nonempty() -> None:
    """Guard: if filtering ever silently drops every operation, the fuzz run becomes a
    no-op that looks green. Fail loudly instead."""
    assert _SHARED_GET, "No shared GET operations selected for fuzzing — check the include filter."
    # Sanity: quarantine entries should actually be shared operations, not typos.
    stray = sorted(set(QUARANTINE) - _SHARED_GET)
    assert not stray, f"QUARANTINE references non-shared operations: {stray}"


# Keep an explicit reference so linters don't flag the backlog import as unused; the
# import documents that the fuzz target set is the complement of the TRUTH_ONLY backlog.
_ = TRUTH_ONLY
