"""Contract tests for the fault-injection control plane (spec/fault_injection.md)."""

from __future__ import annotations

import time

import httpx2 as httpx
import pytest
from mastodon.Mastodon import MastodonServiceUnavailableError

from mastodon_mock.config import DatabaseConfig, FaultConfig, MastodonMockConfig
from mastodon_mock.testing import MockServer
from mastodon_mock.testing.seed import DEFAULT_TEST_SEED

pytestmark = pytest.mark.mock_only


def test_status_fault_then_recovers(mastodon_mock_server: MockServer) -> None:
    """A counted 503 fires once, then the endpoint recovers."""
    alice = mastodon_mock_server.client("alice")
    with (
        mastodon_mock_server.fault(path="/api/v1/statuses", methods=["POST"], status=503, count=1),
        pytest.raises(MastodonServiceUnavailableError),
    ):
        alice.status_post("should fail")
    # rule auto-cleared on context exit
    posted = alice.status_post("should work")
    assert posted["id"]


def test_fault_count_expires(mastodon_mock_server: MockServer) -> None:
    """A rule with ``count`` disappears from the list once exhausted."""
    base = mastodon_mock_server.base_url
    httpx.post(
        f"{base}/api/v1/_mock/faults",
        json={"match": {"path": "/api/v1/instance"}, "effect": {"type": "status", "status": 500}, "count": 1},
    ).raise_for_status()
    assert httpx.get(f"{base}/api/v1/instance").status_code == 500
    assert httpx.get(f"{base}/api/v1/instance").status_code == 200
    assert httpx.get(f"{base}/api/v1/_mock/faults").json() == []


def test_ratelimit_fault_sets_headers(mastodon_mock_server: MockServer) -> None:
    """The ratelimit effect populates ``X-RateLimit-*`` + ``Retry-After``."""
    base = mastodon_mock_server.base_url
    with mastodon_mock_server.fault(path="/api/v1/timelines/home", type="ratelimit", count=1):
        resp = httpx.get(f"{base}/api/v1/timelines/home", headers={"Authorization": "Bearer alice_token"})
    assert resp.status_code == 429
    assert resp.headers["X-RateLimit-Remaining"] == "0"
    assert "Retry-After" in resp.headers


def test_malformed_fault_breaks_parser(mastodon_mock_server: MockServer) -> None:
    """The malformed effect returns 200 with non-JSON, tripping a JSON parse."""
    import json

    base = mastodon_mock_server.base_url
    with mastodon_mock_server.fault(path="/api/v1/instance", type="malformed", count=1):
        resp = httpx.get(f"{base}/api/v1/instance")
        assert resp.status_code == 200
        with pytest.raises(json.JSONDecodeError):
            resp.json()


def test_latency_fault_delays(mastodon_mock_server: MockServer) -> None:
    """The latency effect adds the configured delay then succeeds."""
    base = mastodon_mock_server.base_url
    with mastodon_mock_server.fault(path="/api/v1/instance", type="latency", delay_ms=400, count=1):
        start = time.time()
        resp = httpx.get(f"{base}/api/v1/instance")
        elapsed = time.time() - start
    assert resp.status_code == 200
    assert elapsed >= 0.4


def test_glob_path_match(mastodon_mock_server: MockServer) -> None:
    """A ``*`` glob in the path matches sub-resources."""
    alice = mastodon_mock_server.client("alice")
    post = alice.status_post("hi")
    with (
        mastodon_mock_server.fault(path="/api/v1/statuses/*", status=503, count=1),
        pytest.raises(MastodonServiceUnavailableError),
    ):
        alice.status(post["id"])


def test_faults_never_hit_control_plane(mastodon_mock_server: MockServer) -> None:
    """A match-everything rule still leaves the ``_mock`` control plane reachable."""
    base = mastodon_mock_server.base_url
    httpx.post(
        f"{base}/api/v1/_mock/faults",
        json={"effect": {"type": "status", "status": 500}},  # no path ⇒ matches all
    ).raise_for_status()
    # The faults API itself is exempt, so we can still clear the rule.
    assert httpx.delete(f"{base}/api/v1/_mock/faults").status_code == 200
    assert httpx.get(f"{base}/api/v1/instance").status_code == 200


def test_reset_clears_faults(mastodon_mock_server: MockServer) -> None:
    """``/_mock/reset`` drops all fault rules."""
    base = mastodon_mock_server.base_url
    httpx.post(
        f"{base}/api/v1/_mock/faults",
        json={"match": {"path": "/api/v1/instance"}, "effect": {"type": "status", "status": 500}},
    ).raise_for_status()
    mastodon_mock_server.reset()
    assert httpx.get(f"{base}/api/v1/_mock/faults").json() == []
    assert httpx.get(f"{base}/api/v1/instance").status_code == 200


def test_faults_disabled_404s() -> None:
    """With faults off, the control-plane routes 404."""
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=DEFAULT_TEST_SEED,
        faults=FaultConfig(enabled=False),
    )
    with MockServer(config=config) as server:
        assert httpx.get(f"{server.base_url}/api/v1/_mock/faults").status_code == 404
