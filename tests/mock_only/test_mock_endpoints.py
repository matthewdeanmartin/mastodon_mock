"""Tests for mastodon_mock-specific convenience endpoints.

These are inherently mock-only (a real Mastodon has no ``/api/v1/_mock/*``
routes), so they live here and carry the ``mock_only`` marker. A consuming
project's dual mock/real suite excludes them with ``-m "not mock_only"``.
"""

from __future__ import annotations

import httpx
import pytest
from mastodon import Mastodon

pytestmark = pytest.mark.mock_only


def test_mock_login_issues_working_token(live_server: str) -> None:
    resp = httpx.post(f"{live_server}/api/v1/_mock/login", json={"username": "alice"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "Bearer"
    token = body["access_token"]
    assert token

    # The issued token actually authenticates against the normal API.
    client = Mastodon(access_token=token, api_base_url=live_server)
    assert client.account_verify_credentials().username == "alice"


def test_mock_login_unknown_account_404s(live_server: str) -> None:
    resp = httpx.post(f"{live_server}/api/v1/_mock/login", json={"username": "nobody"})
    assert resp.status_code == 404


def test_mock_reset_restores_seed_state(live_server: str, alice: Mastodon) -> None:
    # Mutate state: post a status.
    posted = alice.status_post("this should disappear after reset")
    assert alice.status(posted.id).id == posted.id

    resp = httpx.post(f"{live_server}/api/v1/_mock/reset")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # After reset, the seed-defined account still exists and is reachable...
    fresh = Mastodon(access_token="alice_token", api_base_url=live_server)
    assert fresh.account_verify_credentials().username == "alice"
    # ...but the post created above is gone.
    home_ids = {s.id for s in fresh.timeline_home()}
    assert posted.id not in home_ids
