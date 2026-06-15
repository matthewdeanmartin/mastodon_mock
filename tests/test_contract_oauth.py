"""Contract tests for the apps / OAuth endpoints."""

from __future__ import annotations

import httpx
from mastodon import Mastodon


def test_create_app_returns_client_credentials(live_server: str) -> None:
    client_id, client_secret = Mastodon.create_app("test-app", api_base_url=live_server)
    assert client_id
    assert client_secret


def test_client_credentials_grant_and_app_verify(live_server: str) -> None:
    client_id, client_secret = Mastodon.create_app("verify-app", api_base_url=live_server)

    token_resp = httpx.post(
        f"{live_server}/oauth/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "read",
        },
    )
    assert token_resp.status_code == 200
    app_token = token_resp.json()["access_token"]

    verify = httpx.get(
        f"{live_server}/api/v1/apps/verify_credentials",
        headers={"Authorization": f"Bearer {app_token}"},
    )
    assert verify.status_code == 200
    body = verify.json()
    assert body["name"] == "verify-app"


def test_self_service_account_creation(live_server: str) -> None:
    client_id, client_secret = Mastodon.create_app("signup-app", api_base_url=live_server)
    client = Mastodon(client_id=client_id, client_secret=client_secret, api_base_url=live_server)

    user_token = client.create_account(
        username="newbie",
        password="hunter2hunter2",
        email="newbie@example.test",
        agreement=True,
    )
    assert user_token

    user_client = Mastodon(access_token=user_token, api_base_url=live_server)
    me = user_client.account_verify_credentials()
    assert me.username == "newbie"


def test_duplicate_username_signup_is_rejected(live_server: str) -> None:
    client_id, client_secret = Mastodon.create_app("dup-app", api_base_url=live_server)

    # "alice" already exists in the seed; signing up again must 422.
    token = _app_token(live_server, client_id, client_secret)
    resp = httpx.post(
        f"{live_server}/api/v1/accounts",
        data={
            "username": "alice",
            "email": "alice2@example.test",
            "password": "hunter2hunter2",
            "agreement": "true",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_signup_requires_agreement(live_server: str) -> None:
    client_id, client_secret = Mastodon.create_app("agree-app", api_base_url=live_server)
    token = _app_token(live_server, client_id, client_secret)
    resp = httpx.post(
        f"{live_server}/api/v1/accounts",
        data={
            "username": "noagree",
            "email": "noagree@example.test",
            "password": "hunter2hunter2",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


def test_unsupported_grant_type_rejected(live_server: str) -> None:
    resp = httpx.post(f"{live_server}/oauth/token", data={"grant_type": "password"})
    assert resp.status_code == 400


def test_token_revocation(live_server: str) -> None:
    client = Mastodon(access_token="alice_token", api_base_url=live_server)
    assert client.account_verify_credentials().username == "alice"

    resp = httpx.post(f"{live_server}/oauth/revoke", data={"token": "alice_token"})
    assert resp.status_code == 200

    revoked = httpx.get(
        f"{live_server}/api/v1/accounts/verify_credentials",
        headers={"Authorization": "Bearer alice_token"},
    )
    assert revoked.status_code == 401


def test_oauth_server_metadata(live_server: str) -> None:
    resp = httpx.get(f"{live_server}/.well-known/oauth-authorization-server")
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_endpoint"].endswith("/oauth/token")
    assert "client_credentials" in body["grant_types_supported"]


def test_oauth_userinfo(live_server: str) -> None:
    resp = httpx.get(
        f"{live_server}/oauth/userinfo",
        headers={"Authorization": "Bearer alice_token"},
    )
    assert resp.status_code == 200
    assert resp.json()["preferred_username"] == "alice"


def _app_token(base_url: str, client_id: str, client_secret: str) -> str:
    """Obtain an app-only token via the client_credentials grant."""
    resp = httpx.post(
        f"{base_url}/oauth/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "read write",
        },
    )
    resp.raise_for_status()
    return str(resp.json()["access_token"])
