"""Contract tests for the mock-only web-settings endpoints (``/api/v1/_mock/settings`` etc.).

These back the SPA's full-page settings area. Mock-only because real Mastodon has no
public API for its web-UI settings (appearance, email notifications, automated post
deletion, import/export, invites, authorized apps).
"""

from __future__ import annotations

import httpx2 as httpx
import pytest
from mastodon import Mastodon

pytestmark = pytest.mark.mock_only


def _auth(client: Mastodon) -> dict[str, str]:
    return {"Authorization": f"Bearer {client.access_token}"}


def test_settings_defaults_and_merge(live_server: str, alice: Mastodon) -> None:
    resp = httpx.get(f"{live_server}/api/v1/_mock/settings", headers=_auth(alice))
    assert resp.status_code == 200
    body = resp.json()
    assert body["appearance"]["theme"] == "auto"
    assert body["post_deletion"]["enabled"] is False

    # Partial PUT deep-merges: sibling keys survive.
    resp = httpx.put(
        f"{live_server}/api/v1/_mock/settings",
        headers=_auth(alice),
        json={"appearance": {"theme": "dark"}, "post_deletion": {"enabled": True, "min_age_days": 7}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["appearance"]["theme"] == "dark"
    assert body["appearance"]["reduce_motion"] is False
    assert body["post_deletion"] == {**body["post_deletion"], "enabled": True, "min_age_days": 7}

    # Persisted across requests.
    again = httpx.get(f"{live_server}/api/v1/_mock/settings", headers=_auth(alice)).json()
    assert again["appearance"]["theme"] == "dark"


def test_settings_requires_auth(live_server: str) -> None:
    assert httpx.get(f"{live_server}/api/v1/_mock/settings").status_code == 401


def test_invites_lifecycle(live_server: str, alice: Mastodon) -> None:
    created = httpx.post(f"{live_server}/api/v1/_mock/invites", headers=_auth(alice), json={"max_uses": 5})
    assert created.status_code == 200
    invite = created.json()
    assert invite["max_uses"] == 5
    assert invite["uses"] == 0
    assert invite["revoked"] is False
    assert invite["code"] in invite["url"]

    listed = httpx.get(f"{live_server}/api/v1/_mock/invites", headers=_auth(alice)).json()
    assert any(i["id"] == invite["id"] for i in listed)

    revoked = httpx.delete(f"{live_server}/api/v1/_mock/invites/{invite['id']}", headers=_auth(alice))
    assert revoked.status_code == 200
    assert revoked.json()["revoked"] is True


def test_invite_validation(live_server: str, alice: Mastodon) -> None:
    resp = httpx.post(f"{live_server}/api/v1/_mock/invites", headers=_auth(alice), json={"max_uses": -1})
    assert resp.status_code == 422
    resp = httpx.delete(f"{live_server}/api/v1/_mock/invites/999999", headers=_auth(alice))
    assert resp.status_code == 404


def test_export_following_csv(live_server: str, alice: Mastodon) -> None:
    # Seed has alice following bob.
    resp = httpx.get(f"{live_server}/api/v1/_mock/export/following", headers=_auth(alice))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    lines = resp.text.strip().splitlines()
    assert lines[0].startswith("Account address")
    assert any(line.startswith("bob") for line in lines[1:])


def test_export_unknown_kind_404s(live_server: str, alice: Mastodon) -> None:
    assert httpx.get(f"{live_server}/api/v1/_mock/export/nonsense", headers=_auth(alice)).status_code == 404


def test_import_mutes_roundtrip(live_server: str, alice: Mastodon, carol: Mastodon) -> None:
    carol_username = carol.account_verify_credentials().username
    resp = httpx.post(
        f"{live_server}/api/v1/_mock/import",
        headers=_auth(alice),
        json={"type": "mutes", "csv": f"Account address,Hide notifications\n{carol_username},true\nghost@nowhere,true"},
    )
    assert resp.status_code == 200
    report = resp.json()
    assert report["imported"] == 1
    assert report["skipped"] == ["ghost@nowhere"]

    muted = {a["username"] for a in alice.mutes()}
    assert carol_username in muted


def test_import_validation(live_server: str, alice: Mastodon) -> None:
    resp = httpx.post(f"{live_server}/api/v1/_mock/import", headers=_auth(alice), json={"type": "nonsense", "csv": "x"})
    assert resp.status_code == 422
    resp = httpx.post(f"{live_server}/api/v1/_mock/import", headers=_auth(alice), json={"type": "mutes"})
    assert resp.status_code == 422


def test_authorized_apps_lists_token_app(live_server: str) -> None:
    # Register an app and mint a user token through it so the join has a row.
    app = httpx.post(
        f"{live_server}/api/v1/apps",
        json={"client_name": "Settings Test App", "redirect_uris": "urn:ietf:wg:oauth:2.0:oob"},
    ).json()
    token = httpx.post(
        f"{live_server}/oauth/token",
        json={
            "grant_type": "authorization_code",
            "client_id": app["client_id"],
            "client_secret": app["client_secret"],
            "code": "mockcode_alice",  # permissive code flow: the code embeds the username
        },
    )
    assert token.status_code == 200
    access = token.json()["access_token"]
    resp = httpx.get(f"{live_server}/api/v1/_mock/apps", headers={"Authorization": f"Bearer {access}"})
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "Settings Test App" in names
