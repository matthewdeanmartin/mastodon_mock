"""Stateful collection behavior through public REST endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mastodon_mock.app import create_app
from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig
from mastodon_mock.db.models import Account


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """Seed an owner, local member, and remote member."""
    config = MastodonMockConfig(
        seed=SeedConfig(
            accounts=[
                SeedAccount(username="owner", access_token="owner_token"),
                SeedAccount(username="member", access_token="member_token"),
                SeedAccount(username="remote", domain="elsewhere.example", invalid_handle=True),
            ]
        )
    )
    with TestClient(create_app(config), headers={"Authorization": "Bearer owner_token"}) as test_client:
        yield test_client


def test_collection_round_trip_and_revocation(client: TestClient) -> None:
    """Collections persist, protect ownership, and remove revoked items from reads."""
    member_headers = {"Authorization": "Bearer member_token"}
    owner_id = client.get("/api/v1/accounts/verify_credentials").json()["id"]
    member = client.patch(
        "/api/v1/accounts/update_credentials", json={"discoverable": True}, headers=member_headers
    ).json()
    remote = client.get("/api/v1/accounts/lookup", params={"acct": "remote@elsewhere.example"}).json()
    result = client.post(
        "/api/v1/collections",
        json={
            "name": "Bird watchers",
            "discoverable": True,
            "account_ids": [member["id"], remote["id"]],
        },
    )
    assert result.status_code == 200
    collection = result.json()["collection"]
    path = f'/api/v1/collections/{collection["id"]}'
    assert [item["state"] for item in collection["items"]] == ["accepted", "pending"]
    assert client.get(path).json()["collection"]["item_count"] == 2
    notification = client.get("/api/v1/notifications", headers=member_headers).json()[0]
    assert notification["type"] == "added_to_collection"
    assert notification["collection"]["id"] == collection["id"]
    group = client.get("/api/v2/notifications", headers=member_headers).json()["notification_groups"][0]
    assert isinstance(group["most_recent_notification_id"], int)
    assert group["collection"]["id"] == collection["id"]
    public = client.get(path, headers={"Authorization": ""}).json()
    assert public["collection"]["item_count"] == 1
    assert {account["id"] for account in public["accounts"]} == {owner_id, member["id"]}
    assert client.patch(path, json={"name": "Stolen"}, headers=member_headers).status_code == 403
    assert client.delete(path, headers=member_headers).status_code == 403
    assert client.patch(path, data={"name": "New name"}).json()["collection"]["name"] == "New name"
    notification = client.get("/api/v1/notifications", headers=member_headers).json()[0]
    assert notification["type"] == "collection_update"
    assert notification["collection"]["name"] == "New name"
    assert client.get(f'/api/v1/accounts/{member["id"]}/in_collections').status_code == 403
    assert (
        len(client.get(f'/api/v1/accounts/{member["id"]}/in_collections', headers=member_headers).json()["collections"])
        == 1
    )
    item_path = f'{path}/items/{collection["items"][0]["id"]}'
    assert client.post(item_path + "/revoke").status_code == 403
    assert client.post(item_path + "/revoke", headers=member_headers).status_code == 200
    assert client.get(path).json()["collection"]["item_count"] == 1
    assert client.delete(item_path).status_code == 200
    assert client.delete(path).status_code == 200
    assert client.get("/api/v1/notifications", headers=member_headers).json() == []
    assert client.get(path).status_code == 404
    assert client.get(f"/api/v1/accounts/{owner_id}/collections").json() == {"collections": []}


def test_collection_visibility_pagination_and_atomic_validation(client: TestClient) -> None:
    """Private listings, invalid writes, item validation, and offset links work."""
    owner_id = client.get("/api/v1/accounts/verify_credentials").json()["id"]
    listing = f"/api/v1/accounts/{owner_id}/collections"
    assert client.post("/api/v1/collections", json={"name": ""}).status_code == 422
    assert client.post("/api/v1/collections", json={"name": "bad", "account_ids": ["missing"]}).status_code == 404
    assert client.get(listing).json() == {"collections": []}
    for name in ["one", "two"]:
        assert client.post("/api/v1/collections", json={"name": name}).status_code == 200
    assert client.get(listing, headers={"Authorization": ""}).json() == {"collections": []}
    page = client.get(listing, params={"limit": 1})
    assert 'rel="next"' in page.headers["link"]
    next_url = page.headers["link"].split(">")[0][1:]
    assert client.get(next_url).json()["collections"][0]["name"] != page.json()["collections"][0]["name"]
    collection_id = page.json()["collections"][0]["id"]
    path = f"/api/v1/collections/{collection_id}"
    assert client.patch(path, json={"name": "bad", "description": "x" * 101}).status_code == 422
    assert client.get(path).json()["collection"]["name"] == "two"
    assert client.post(path + "/items", json={}).status_code == 422
    assert client.post(path + "/items", json={"account_id": "missing"}).status_code == 404
    # Local accounts must opt into discovery before others may feature them.
    member = client.get("/api/v1/accounts/lookup", params={"acct": "member"}).json()
    assert client.post(path + "/items", json={"account_id": member["id"]}).status_code == 403


def test_collection_item_parent_scope_and_limit(client: TestClient) -> None:
    """Item identifiers cannot cross parents and the 26th item is rejected."""
    remote_id = client.get("/api/v1/accounts/lookup", params={"acct": "remote@elsewhere.example"}).json()["id"]
    first = client.post("/api/v1/collections", json={"name": "one", "account_ids": [remote_id]}).json()["collection"]
    second = client.post("/api/v1/collections", json={"name": "two"}).json()["collection"]
    assert client.delete(f'/api/v1/collections/{second["id"]}/items/{first["items"][0]["id"]}').status_code == 404
    assert client.post(f'/api/v1/collections/{first["id"]}/items', json={"account_id": remote_id}).status_code == 422
    with client.app.state.session_factory() as db:
        remote_accounts = [Account(username=f"remote{i}", domain="elsewhere.example") for i in range(25)]
        db.add_all(remote_accounts)
        db.commit()
        ids = [str(account.id) for account in remote_accounts]
    for account_id in ids[:24]:
        assert (
            client.post(f'/api/v1/collections/{first["id"]}/items', data={"account_id": account_id}).status_code == 200
        )
    assert client.post(f'/api/v1/collections/{first["id"]}/items', json={"account_id": ids[24]}).status_code == 422


def test_collections_survive_restart(tmp_path: Path) -> None:
    """Durable collection state is independent of app process lifetime."""
    config = MastodonMockConfig(database=DatabaseConfig(path=str(tmp_path / "mock.sqlite")))
    with TestClient(create_app(config), headers={"Authorization": "Bearer mock_token"}) as first:
        collection_id = first.post("/api/v1/collections", json={"name": "Persistent"}).json()["collection"]["id"]
    with TestClient(create_app(config)) as second:
        assert second.get(f"/api/v1/collections/{collection_id}").json()["collection"]["name"] == "Persistent"


def test_collection_account_limit(client: TestClient) -> None:
    """The mock uses Mastodon's default per-account limit of ten collections."""
    for index in range(10):
        assert client.post("/api/v1/collections", json={"name": f"Collection {index}"}).status_code == 200
    assert client.post("/api/v1/collections", json={"name": "Eleven"}).status_code == 422
