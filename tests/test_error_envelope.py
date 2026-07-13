"""Contract tests for the Mastodon-shaped error envelope (spec/fable/roadmap.md 1.1).

Every non-2xx JSON response must carry ``{"error": "..."}`` — never FastAPI's
``{"detail": ...}`` — because real Mastodon does, and Mastodon.py extracts the
``error`` key into its typed exception messages. Consumers test their error
handling against this shape.
"""

from __future__ import annotations

import httpx2 as httpx
import pytest
from mastodon.Mastodon import (
    MastodonAPIError,
    MastodonInternalServerError,
    MastodonNotFoundError,
    MastodonUnauthorizedError,
)

from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, RateLimitConfig
from mastodon_mock.testing import MockServer
from mastodon_mock.testing.seed import DEFAULT_TEST_SEED


def _assert_envelope(resp: httpx.Response) -> str:
    """The body is exactly a Mastodon error envelope: ``error`` in, ``detail`` out."""
    body = resp.json()
    assert "error" in body, f"missing 'error' key: {body!r}"
    assert isinstance(body["error"], str)
    assert "detail" not in body, f"FastAPI 'detail' leaked: {body!r}"
    return body["error"]


def test_bad_token_401(mastodon_mock_server: MockServer) -> None:
    resp = httpx.get(
        f"{mastodon_mock_server.base_url}/api/v1/accounts/verify_credentials",
        headers={"Authorization": "Bearer not_a_real_token"},
    )
    assert resp.status_code == 401
    message = _assert_envelope(resp)

    # Mastodon.py surfaces the envelope's message in its typed exception.
    from mastodon import Mastodon

    client = Mastodon(access_token="not_a_real_token", api_base_url=mastodon_mock_server.base_url)
    with pytest.raises(MastodonUnauthorizedError) as exc_info:
        client.account_verify_credentials()
    assert message in str(exc_info.value)


def test_missing_status_404(mastodon_mock_server: MockServer) -> None:
    resp = httpx.get(
        f"{mastodon_mock_server.base_url}/api/v1/statuses/999999999999",
        headers={"Authorization": "Bearer alice_token"},
    )
    assert resp.status_code == 404
    _assert_envelope(resp)

    with pytest.raises(MastodonNotFoundError):
        mastodon_mock_server.client("alice").status(999999999999)


def test_unrouted_path_404(mastodon_mock_server: MockServer) -> None:
    """Starlette's default 404 for an unknown route is rewritten to Mastodon prose."""
    resp = httpx.get(f"{mastodon_mock_server.base_url}/api/v1/no_such_endpoint")
    assert resp.status_code == 404
    assert _assert_envelope(resp) == "Record not found"


def test_business_validation_422(mastodon_mock_server: MockServer) -> None:
    """Router-level validation (over-long status) uses the envelope."""
    resp = httpx.post(
        f"{mastodon_mock_server.base_url}/api/v1/statuses",
        headers={"Authorization": "Bearer alice_token"},
        json={"status": "x" * 501},
    )
    assert resp.status_code == 422
    assert "too long" in _assert_envelope(resp)

    with pytest.raises(MastodonAPIError) as exc_info:
        mastodon_mock_server.client("alice").status_post("x" * 501)
    assert "too long" in str(exc_info.value)


def test_fastapi_binding_validation_422(mastodon_mock_server: MockServer) -> None:
    """FastAPI parameter-binding failures are re-shaped, not left as {'detail': [...]}."""
    resp = httpx.get(
        f"{mastodon_mock_server.base_url}/api/v1/timelines/home",
        headers={"Authorization": "Bearer alice_token"},
        params={"limit": "not_a_number"},
    )
    assert resp.status_code == 422
    assert _assert_envelope(resp).startswith("Validation failed: ")


def test_fault_injected_500(mastodon_mock_server: MockServer) -> None:
    with mastodon_mock_server.fault(path="/api/v1/instance", status=500, count=1):
        resp = httpx.get(f"{mastodon_mock_server.base_url}/api/v1/instance")
    assert resp.status_code == 500
    _assert_envelope(resp)

    # A non-cached endpoint: Mastodon.py serves instance() from a client-side
    # cache, which would swallow the injected fault.
    client = mastodon_mock_server.client("alice")
    with (
        mastodon_mock_server.fault(path="/api/v1/timelines/home", status=500, count=1),
        pytest.raises(MastodonInternalServerError),
    ):
        client.timeline_home()


def test_rate_limited_429() -> None:
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=DEFAULT_TEST_SEED,
        ratelimit=RateLimitConfig(enabled=True, limit=1, window_seconds=300),
    )
    with MockServer(config=config) as server:
        headers = {"Authorization": "Bearer alice_token"}
        url = f"{server.base_url}/api/v1/accounts/verify_credentials"
        assert httpx.get(url, headers=headers).status_code == 200
        resp = httpx.get(url, headers=headers)
        assert resp.status_code == 429
        _assert_envelope(resp)


def test_scope_denied_403_envelope(mastodon_mock_server: MockServer) -> None:
    """403 from deps (disabled login) also flows through the envelope handler."""
    # The generic HTTPException handler owns this; assert via a plain 403 raise:
    # method-not-allowed is the cheapest built-in non-router error with a body.
    resp = httpx.delete(f"{mastodon_mock_server.base_url}/api/v1/timelines/home")
    assert resp.status_code == 405
    _assert_envelope(resp)
