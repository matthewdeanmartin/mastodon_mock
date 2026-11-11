"""Serialize collections and their viewer-visible account memberships."""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Collection, CollectionItem, Relationship
from mastodon_mock.serializers.common import iso

__all__ = ["blocked", "serialize_collection", "serialize_item", "visible_items"]


def blocked(db: Session, first: int, second: int) -> bool:
    """Check account blocks in either direction."""
    return (
        db.scalar(
            select(Relationship.id).where(
                Relationship.blocking.is_(True),
                or_(
                    (Relationship.source_account_id == first) & (Relationship.target_account_id == second),
                    (Relationship.source_account_id == second) & (Relationship.target_account_id == first),
                ),
            )
        )
        is not None
    )


def visible_items(db: Session, row: Collection, viewer: Account | None) -> list[CollectionItem]:
    """Owners see pending items; others see only accepted, available accounts."""
    states = ("accepted", "pending") if viewer and viewer.id == row.account_id else ("accepted",)
    items = db.scalars(
        select(CollectionItem)
        .join(Account, Account.id == CollectionItem.account_id)
        .where(
            CollectionItem.collection_id == row.id,
            CollectionItem.state.in_(states),
            Account.requested_deletion_at.is_(None),
            Account.suspended.is_(False),
        )
        .order_by(CollectionItem.id)
    ).all()
    return [item for item in items if viewer is None or not blocked(db, item.account_id, viewer.id)]


def serialize_item(item: CollectionItem) -> dict[str, Any]:
    """Serialize a collection membership."""
    data: dict[str, Any] = {"id": str(item.id), "state": item.state, "created_at": iso(item.created_at)}
    if item.state in ("pending", "accepted"):
        data["account_id"] = str(item.account_id)
    return data


def serialize_collection(
    db: Session, row: Collection, config: MastodonMockConfig, viewer: Account | None
) -> dict[str, Any]:
    """Serialize a collection using viewer-relative item visibility."""
    items = visible_items(db, row, viewer)
    url = f"{config.base_url}/collections/{row.id}"
    return {
        "id": str(row.id),
        "account_id": str(row.account_id),
        "name": row.name,
        "description": row.description,
        "language": row.language,
        "sensitive": row.sensitive,
        "discoverable": row.discoverable,
        "local": True,
        "uri": url,
        "url": url,
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "tag": {"name": row.tag_name, "url": f"{config.base_url}/tags/{row.tag_name}"} if row.tag_name else None,
        "items": [serialize_item(item) for item in items],
        "item_count": len(items),
    }
