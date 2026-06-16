import httpx2 as httpx
import pytest
from mastodon import Mastodon
from mastodon.errors import MastodonNotFoundError


@pytest.fixture()
def admin_client(live_server: str) -> Mastodon:
    return Mastodon(access_token="alice_token", api_base_url=live_server)


def test_admin_account_lookup_404(admin_client: Mastodon) -> None:
    with pytest.raises(MastodonNotFoundError):
        admin_client.admin_account(123456789)


def test_admin_accounts_filtering(live_server: str) -> None:
    # Test origin=remote via httpx since Mastodon.py might not support all params
    with httpx.Client(base_url=live_server, headers={"Authorization": "Bearer alice_token"}) as client:
        resp = client.get("/api/v2/admin/accounts", params={"origin": "remote"})
        resp.raise_for_status()
        remote = resp.json()
        # Dave is remote in TEST_SEED
        assert any(a["username"] == "dave" for a in remote)
        assert all(a["domain"] is not None for a in remote)

        # Test status=active
        resp = client.get("/api/v2/admin/accounts", params={"status": "active"})
        resp.raise_for_status()
        active = resp.json()
        assert any(a["username"] == "alice" for a in active)


def test_admin_account_action_404(live_server: str) -> None:
    with httpx.Client(base_url=live_server, headers={"Authorization": "Bearer alice_token"}) as client:
        resp = client.post("/api/v1/admin/accounts/123456789/action", json={"type": "none"})
        assert resp.status_code == 404
