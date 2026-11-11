"""Stateful local Mastodon collections; remote approvals remain pending."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from mastodon_mock.db.models import Account, Collection, CollectionItem, Notification, Relationship, utcnow
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import clamp_limit, clamp_offset, parse_db_id
from mastodon_mock.routers.helpers import read_body, truthy
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.collections import blocked, serialize_collection, serialize_item, visible_items
from mastodon_mock.services import add_notification
from mastodon_mock.streaming_events import flush_stream_notifications

__all__ = ["router"]

router = APIRouter(tags=["collections"])


def get_collection_row(db: DbSession, collection_id: str) -> Collection:
    """Find a collection without leaking invalid IDs into database queries."""
    row_id = parse_db_id(collection_id)
    row = db.get(Collection, row_id) if row_id is not None else None
    if row is None:
        raise HTTPException(404, "Record not found")
    return row


def get_account_row(db: DbSession, account_id: str) -> Account:
    """Find an account that has not requested deletion."""
    row_id = parse_db_id(account_id)
    row = db.get(Account, row_id) if row_id is not None else None
    if row is None or row.requested_deletion_at is not None:
        raise HTTPException(404, "Record not found")
    return row


def require_owner(row: Collection, viewer: Account) -> None:
    """Only the owner may mutate a collection."""
    if row.account_id != viewer.id:
        raise HTTPException(403, "This action is not allowed")


def update_values(row: Collection, body: dict[str, Any]) -> None:
    """Validate local collection fields before committing."""
    for name in ("name", "description", "language", "tag_name"):
        if name in body:
            value = body[name]
            setattr(row, name, str(value) if value is not None else None)
    if not row.name or not row.name.strip() or len(row.name) > 40:
        raise HTTPException(422, "Name must contain between 1 and 40 characters")
    if row.description and len(row.description) > 100:
        raise HTTPException(422, "Description is too long (maximum is 100 characters)")
    for name in ("sensitive", "discoverable"):
        if name in body:
            setattr(row, name, truthy(body[name]))
    row.updated_at = utcnow()


def add_item(db: DbSession, row: Collection, target: Account, owner: Account) -> CollectionItem:
    """Add an eligible account, enforcing the local 25-item limit."""
    following = (
        db.scalar(
            select(Relationship.id).where(
                Relationship.source_account_id == owner.id,
                Relationship.target_account_id == target.id,
                Relationship.following.is_(True),
            )
        )
        is not None
    )
    if (
        target.suspended
        or blocked(db, owner.id, target.id)
        or (
            target.domain is None
            and (not target.discoverable or (target.locked and target.id != owner.id and not following))
        )
    ):
        raise HTTPException(403, "This account cannot be added to collections")
    existing = db.scalars(
        select(CollectionItem).where(
            CollectionItem.collection_id == row.id, CollectionItem.state.in_(("accepted", "pending"))
        )
    ).all()
    if (
        db.scalar(
            select(CollectionItem.id).where(
                CollectionItem.collection_id == row.id, CollectionItem.account_id == target.id
            )
        )
        is not None
    ):
        raise HTTPException(422, "Account has already been added to this collection")
    if len(existing) >= 25:
        raise HTTPException(422, "A collection cannot contain more than 25 accounts")
    item = CollectionItem(collection_id=row.id, account_id=target.id, state="pending" if target.domain else "accepted")
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(422, "Account has already been added to this collection") from None
    row.updated_at = utcnow()
    if target.domain is None:
        notification = add_notification(
            db, recipient_id=target.id, from_account_id=owner.id, type_="added_to_collection"
        )
        if notification is not None:
            notification.collection_id = row.id
    return item


@router.post("/api/v1/collections")
async def create_collection(
    request: Request, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Create a collection and its initial items atomically."""
    body = await read_body(request)
    count = db.scalar(select(func.count()).select_from(Collection).where(Collection.account_id == account.id)) or 0
    if count >= 10:
        raise HTTPException(422, "An account cannot create more than 10 collections")
    row = Collection(account_id=account.id, name="", discoverable=False, sensitive=False)
    update_values(row, body)
    db.add(row)
    db.flush()
    ids = body.get("account_ids", [])
    if not isinstance(ids, list):
        ids = [ids]
    for account_id in ids:
        add_item(db, row, get_account_row(db, str(account_id)), account)
    db.commit()
    flush_stream_notifications(request.app, db, config)
    return {"collection": serialize_collection(db, row, config, account)}


@router.get("/api/v1/collections/{collection_id}")
def get_collection(collection_id: str, db: DbSession, config: Config, viewer: CurrentAccount) -> dict[str, Any]:
    """Return a collection with its owner and visible member account entities."""
    row = get_collection_row(db, collection_id)
    owner = get_account_row(db, str(row.account_id))
    if viewer and blocked(db, owner.id, viewer.id):
        raise HTTPException(403, "This action is not allowed")
    accounts = [owner] + [get_account_row(db, str(item.account_id)) for item in visible_items(db, row, viewer)]
    return {
        "collection": serialize_collection(db, row, config, viewer),
        "accounts": [serialize_account(db, account, config) for account in accounts],
    }


@router.patch("/api/v1/collections/{collection_id}")
async def update_collection(
    collection_id: str, request: Request, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Update a collection owned by the authenticated account."""
    row = get_collection_row(db, collection_id)
    require_owner(row, account)
    significant = ("name", "description", "sensitive", "tag_name")
    before = tuple(getattr(row, name) for name in significant)
    update_values(row, await read_body(request))
    if before != tuple(getattr(row, name) for name in significant):
        for target in db.scalars(
            select(Account)
            .join(CollectionItem, CollectionItem.account_id == Account.id)
            .where(
                CollectionItem.collection_id == row.id,
                CollectionItem.state == "accepted",
                Account.domain.is_(None),
            )
        ):
            notification = add_notification(
                db, recipient_id=target.id, from_account_id=account.id, type_="collection_update"
            )
            if notification is not None:
                notification.collection_id = row.id
    db.commit()
    flush_stream_notifications(request.app, db, config)
    return {"collection": serialize_collection(db, row, config, account)}


@router.delete("/api/v1/collections/{collection_id}")
def delete_collection(collection_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete an owned collection and all its items."""
    row = get_collection_row(db, collection_id)
    require_owner(row, account)
    db.execute(delete(Notification).where(Notification.collection_id == row.id))
    db.execute(delete(CollectionItem).where(CollectionItem.collection_id == row.id))
    db.delete(row)
    db.commit()
    return {}


@router.post("/api/v1/collections/{collection_id}/items")
async def add_collection_item(
    collection_id: str, request: Request, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Add one account and return the wrapped membership."""
    row = get_collection_row(db, collection_id)
    require_owner(row, account)
    body = await read_body(request)
    if not body.get("account_id"):
        raise HTTPException(422, "account_id parameter is missing")
    item = add_item(db, row, get_account_row(db, str(body["account_id"])), account)
    db.commit()
    flush_stream_notifications(request.app, db, config)
    return {"collection_item": serialize_item(item)}


def get_item(db: DbSession, row: Collection, item_id: str) -> CollectionItem:
    """Look up a membership scoped to its parent collection."""
    item = db.get(CollectionItem, parse_db_id(item_id)) if parse_db_id(item_id) is not None else None
    if item is None or item.collection_id != row.id:
        raise HTTPException(404, "Record not found")
    return item


@router.delete("/api/v1/collections/{collection_id}/items/{item_id}")
def delete_collection_item(collection_id: str, item_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove a membership as the collection owner."""
    row = get_collection_row(db, collection_id)
    require_owner(row, account)
    db.delete(get_item(db, row, item_id))
    row.updated_at = utcnow()
    db.commit()
    return {}


@router.post("/api/v1/collections/{collection_id}/items/{item_id}/revoke")
def revoke_collection_item(collection_id: str, item_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Revoke membership as the featured account, rather than the owner."""
    row = get_collection_row(db, collection_id)
    item = get_item(db, row, item_id)
    if item.account_id != account.id:
        raise HTTPException(403, "This action is not allowed")
    item.state = "revoked"
    row.updated_at = utcnow()
    db.commit()
    return {}


def list_collections(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    viewer: Account | None,
    account_id: str,
    *,
    membership: bool = False,
) -> dict[str, Any]:
    """List collections with offset pagination and viewer-relative visibility."""
    target = get_account_row(db, account_id)
    if membership and (viewer is None or viewer.id != target.id):
        raise HTTPException(403, "This action is not allowed")
    if viewer and blocked(db, target.id, viewer.id):
        return {"collections": []}
    query = select(Collection)
    if membership:
        query = query.where(
            Collection.id.in_(
                select(CollectionItem.collection_id).where(
                    CollectionItem.account_id == target.id,
                    CollectionItem.state.in_(("pending", "accepted")),
                )
            )
        )
    else:
        query = query.where(Collection.account_id == target.id)
        if viewer is None or viewer.id != target.id:
            query = query.where(Collection.discoverable.is_(True))
    try:
        limit = clamp_limit(int(request.query_params.get("limit", "40")), maximum=100)
        offset = clamp_offset(int(request.query_params.get("offset", "0")))
    except ValueError:
        raise HTTPException(422, "Invalid pagination parameters") from None
    rows = list(
        db.scalars(query.order_by(Collection.created_at.desc(), Collection.id.desc()).offset(offset).limit(limit + 1))
    )
    links = []
    if len(rows) > limit:
        links.append(f'<{request.url.include_query_params(offset=offset + limit, limit=limit)}>; rel="next"')
    if offset:
        links.append(f'<{request.url.include_query_params(offset=max(0, offset - limit), limit=limit)}>; rel="prev"')
    if links:
        response.headers["Link"] = ", ".join(links)
    return {"collections": [serialize_collection(db, row, config, viewer) for row in rows[:limit]]}


@router.get("/api/v1/accounts/{account_id}/collections")
@router.get("/api/v1/{account_id}/collections", include_in_schema=False)
def account_collections(
    account_id: str, request: Request, response: Response, db: DbSession, config: Config, viewer: CurrentAccount
) -> dict[str, Any]:
    """List an account's collections; undiscoverable ones are owner-only in lists."""
    return list_collections(request, response, db, config, viewer, account_id)


@router.get("/api/v1/accounts/{account_id}/in_collections")
@router.get("/api/v1/{account_id}/in_collections", include_in_schema=False)
def account_in_collections(
    account_id: str, request: Request, response: Response, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """List collections featuring the authenticated account."""
    return list_collections(request, response, db, config, account, account_id, membership=True)
