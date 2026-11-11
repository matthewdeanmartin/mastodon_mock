"""Stable Mastodon compatibility regressions, independent of the frozen UI."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig, SeedAccount, SeedConfig
from mastodon_mock.db.models import (
    Account,
    Notification,
    NotificationRequest,
    Relationship,
    Status,
    StatusMention,
    utcnow,
)
from mastodon_mock.versioning import CURRENT_VERSION, api_version_for


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """Use a fresh database and the standard seeded account."""
    with TestClient(create_app(), headers={"Authorization": "Bearer mock_token"}) as test_client:
        yield test_client


@pytest.mark.parametrize("version,level", [("4.6.0", 10), ("4.6.1", 11), ("4.6.11", 11), ("4.7.5", 11)])
def test_patch_level_capabilities(version: str, level: int) -> None:
    """The 4.6.1 patch changed the capability level."""
    assert api_version_for(version) == level


def test_repository_default_matches_supported_target() -> None:
    """Checkout configuration must not override the current version with a stale value."""
    assert MastodonMockConfig.load().mocked_version == CURRENT_VERSION


@pytest.mark.parametrize("endpoint", ["/api/v1/profile", "/api/v1/accounts/update_credentials"])
@pytest.mark.parametrize("encoding", ["json", "data"])
def test_profile_descriptions_round_trip(client: TestClient, endpoint: str, encoding: str) -> None:
    """Descriptions survive writes, omission, public reads, and explicit clearing."""
    body = {"avatar_description": "A green bird", "header_description": "A mountain"}
    response = client.patch(endpoint, **{encoding: body})
    assert response.status_code == 200
    account_id = response.json()["id"]
    assert client.patch(endpoint, json={"display_name": "New name"}).status_code == 200
    for path in ["/api/v1/profile", "/api/v1/accounts/verify_credentials", f"/api/v1/accounts/{account_id}"]:
        result = client.get(path).json()
        assert result["avatar_description"] == "A green bird"
        assert result["header_description"] == "A mountain"
    assert client.patch(endpoint, json={"avatar_description": ""}).json()["avatar_description"] == ""
    assert client.delete("/api/v1/profile/header").status_code == 200
    assert client.get("/api/v1/profile").json()["header_description"] == ""


def test_description_validation_is_atomic(client: TestClient) -> None:
    """Invalid descriptions cannot partially update the profile."""
    before = client.get("/api/v1/profile").json()
    response = client.patch("/api/v1/profile", json={"display_name": "Wrong", "avatar_description": "x" * 151})
    assert response.status_code == 422
    assert client.get("/api/v1/profile").json()["display_name"] == before["display_name"]


def test_invalid_handle_seed_and_deleted_account_visibility() -> None:
    """Invalid remote handles preserve IDs; deleted accounts disappear from reads."""
    config = MastodonMockConfig(
        seed=SeedConfig(
            accounts=[
                SeedAccount(username="remote", domain="example.org", invalid_handle=True),
                SeedAccount(username="deleted", requested_deletion_at=utcnow()),
            ]
        )
    )
    app = create_app(config)
    with TestClient(app) as api:
        with app.state.session_factory() as db:
            remote = db.scalar(select(Account).where(Account.username == "remote"))
            deleted = db.scalar(select(Account).where(Account.username == "deleted"))
            assert remote is not None and deleted is not None
            remote_id, deleted_id = str(remote.id), str(deleted.id)
        data = api.get(f"/api/v1/accounts/{remote_id}").json()
        assert data["id"] == data["username"] == remote_id
        assert data["acct"] == f"{remote_id}@handle.invalid"
        assert data["invalid_handle"] is True
        assert api.get(f"/api/v1/accounts/{deleted_id}").status_code == 404
        assert api.get(f"/api/v1/accounts/{deleted_id}/statuses").status_code == 404
        assert api.get("/api/v1/accounts/lookup", params={"acct": "deleted"}).status_code == 404
        assert [row["id"] for row in api.get("/api/v1/accounts", params={"id[]": [deleted_id, remote_id]}).json()] == [
            remote_id
        ]


def test_exclude_direct_preserves_private_mentions(client: TestClient) -> None:
    """A non-follower may see a private post mentioning them even with exclude_direct."""
    with client.app.state.session_factory() as db:
        viewer = db.scalar(select(Account))
        author = Account(username="author", locked=True)
        db.add(author)
        db.flush()
        assert viewer is not None
        ids = {}
        for visibility in ("direct", "private", "public"):
            status = Status(account_id=author.id, content=visibility, visibility=visibility)
            db.add(status)
            db.flush()
            db.add(StatusMention(status_id=status.id, account_id=viewer.id))
            ids[visibility] = str(status.id)
        author_id = str(author.id)
        db.commit()
    path = f"/api/v1/accounts/{author_id}/statuses"
    assert {row["id"] for row in client.get(path).json()} == set(ids.values())
    filtered = client.get(path, params={"exclude_direct": "true", "limit": 1})
    assert filtered.status_code == 200
    assert "exclude_direct=true" in filtered.headers["link"]
    assert {row["id"] for row in client.get(path, params={"exclude_direct": "true"}).json()} == {
        ids["private"],
        ids["public"],
    }
    assert {row["id"] for row in client.get(path, headers={"Authorization": ""}).json()} == {ids["public"]}


def test_follow_request_count_excludes_unavailable_accounts(client: TestClient) -> None:
    """Suspended and deleted requesters do not inflate pending request counts."""
    with client.app.state.session_factory() as db:
        target = db.scalar(select(Account))
        assert target is not None
        for index in range(43):
            source = Account(
                username=f"requester{index}",
                suspended=index == 0,
                requested_deletion_at=utcnow() if index == 1 else None,
            )
            db.add(source)
            db.flush()
            db.add(Relationship(source_account_id=source.id, target_account_id=target.id, requested_by=True))
        db.commit()
    assert client.get("/api/v1/accounts/verify_credentials").json()["source"]["follow_requests_count"] == 40
    with client.app.state.session_factory() as db:
        for row in db.scalars(select(Account).where(Account.username.like("requester%"))).all():
            if row.username not in ("requester0", "requester1", "requester2"):
                row.suspended = True
        db.commit()
    assert client.get("/api/v1/accounts/verify_credentials").json()["source"]["follow_requests_count"] == 1


def test_disabled_staff_cannot_use_admin_api(client: TestClient) -> None:
    """The fake admin role policy never bypasses account inactivity enforcement."""
    with client.app.state.session_factory() as db:
        account = db.scalar(select(Account))
        assert account is not None
        account.role = "admin"
        account.disabled = True
        db.commit()
    assert client.get("/api/v1/admin/accounts").status_code == 403


def test_bulk_notification_request_dismiss_removes_notifications(client: TestClient) -> None:
    """Bulk dismiss removes filtered notifications but preserves other senders."""
    with client.app.state.session_factory() as db:
        recipient = db.scalar(select(Account))
        assert recipient is not None
        request_ids = []
        for name in ("one", "two"):
            sender = Account(username=name)
            db.add(sender)
            db.flush()
            request = NotificationRequest(account_id=recipient.id, from_account_id=sender.id)
            db.add(request)
            db.flush()
            request_ids.append(str(request.id))
            db.add(
                Notification(account_id=recipient.id, from_account_id=sender.id, type="follow", request_id=request.id)
            )
        db.commit()
    assert client.post("/api/v1/notifications/requests/dismiss", json={"id": [request_ids[0]]}).status_code == 200
    with client.app.state.session_factory() as db:
        assert [str(row.request_id) for row in db.scalars(select(Notification))] == [request_ids[1]]
        assert [str(row.id) for row in db.scalars(select(NotificationRequest))] == [request_ids[1]]
