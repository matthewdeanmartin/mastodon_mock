"""Hashtag endpoints: fetch, follow/unfollow, feature/unfeature, and listings.

See spec/03-api-coverage.md. Tag names are matched case-insensitively (Mastodon
normalizes hashtags to lowercase); follows live in ``followed_tags`` and features
in ``featured_tags``. ``FeaturedTag`` usage stats are derived at read time.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException
from sqlalchemy import func, select

from mastodon_mock.db.models import Account, FeaturedTag, FollowedTag, Status, StatusTag
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.serializers.common import account_acct, iso
from mastodon_mock.serializers.discovery import serialize_featured_tag, serialize_tag

router = APIRouter()


def _uses_today(db: DbSession, name: str) -> int:
    """Total number of local statuses using ``name`` (drives the history block)."""
    return db.scalar(select(func.count()).select_from(StatusTag).where(StatusTag.name == name)) or 0


def _is_following(db: DbSession, account_id: int | None, name: str) -> bool:
    """Whether ``account_id`` follows the hashtag ``name``."""
    if account_id is None:
        return False
    return (
        db.scalar(select(FollowedTag).where(FollowedTag.account_id == account_id, FollowedTag.name == name))
        is not None
    )


def _is_featuring(db: DbSession, account_id: int | None, name: str) -> bool:
    """Whether ``account_id`` features the hashtag ``name`` on its profile."""
    if account_id is None:
        return False
    return (
        db.scalar(select(FeaturedTag).where(FeaturedTag.account_id == account_id, FeaturedTag.name == name))
        is not None
    )


def _serialize(db: DbSession, config: Config, name: str, account_id: int | None) -> dict[str, Any]:
    """Serialize a tag with viewer-relative ``following``/``featuring`` and history."""
    return serialize_tag(
        name,
        config,
        following=_is_following(db, account_id, name),
        featuring=_is_featuring(db, account_id, name),
        uses_today=_uses_today(db, name),
    )


def featured_tags_for(db: DbSession, config: Config, acc: Account) -> list[dict[str, Any]]:
    """Serialized ``FeaturedTag`` list for ``acc``, newest feature first.

    Usage stats (``statuses_count``, ``last_status_at``) are derived from the
    account's statuses bearing each featured tag.
    """
    acct = account_acct(acc.username, acc.domain)
    rows = db.scalars(
        select(FeaturedTag).where(FeaturedTag.account_id == acc.id).order_by(FeaturedTag.id.desc())
    ).all()
    out: list[dict[str, Any]] = []
    for row in rows:
        count, last = db.execute(
            select(func.count(), func.max(Status.created_at))
            .select_from(StatusTag)
            .join(Status, Status.id == StatusTag.status_id)
            .where(Status.account_id == acc.id, StatusTag.name == row.name)
        ).one()
        out.append(
            serialize_featured_tag(
                row.name,
                config,
                acct,
                tag_id=str(row.id),
                statuses_count=int(count or 0),
                last_status_at=iso(last),
            )
        )
    return out


# --- Followed tags ------------------------------------------------------------


@router.get("/api/v1/followed_tags")
def followed_tags(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """Hashtags the logged-in user follows."""
    names = db.scalars(
        select(FollowedTag.name).where(FollowedTag.account_id == account.id).order_by(FollowedTag.name)
    ).all()
    return [_serialize(db, config, name, account.id) for name in names]


# --- Featured tags ------------------------------------------------------------


@router.get("/api/v1/featured_tags")
def featured_tags(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """The logged-in user's featured tags."""
    return featured_tags_for(db, config, account)


@router.get("/api/v1/featured_tags/suggestions")
def featured_tag_suggestions(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """The user's 10 most-used, not-yet-featured hashtags (suggested to feature)."""
    featured = set(
        db.scalars(select(FeaturedTag.name).where(FeaturedTag.account_id == account.id)).all()
    )
    rows = db.execute(
        select(StatusTag.name, func.count().label("count"), func.max(Status.created_at).label("last"))
        .join(Status, Status.id == StatusTag.status_id)
        .where(Status.account_id == account.id)
        .group_by(StatusTag.name)
        .order_by(func.count().desc(), StatusTag.name)
    ).all()
    acct = account_acct(account.username, account.domain)
    out: list[dict[str, Any]] = []
    for name, count, last in rows:
        if name in featured:
            continue
        out.append(
            serialize_featured_tag(name, config, acct, statuses_count=int(count), last_status_at=iso(last))
        )
        if len(out) >= 10:
            break
    return out


@router.post("/api/v1/featured_tags", status_code=200)
def featured_tag_create(
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    name: Annotated[str, Form()],
) -> dict[str, Any]:
    """Feature a hashtag on the logged-in user's profile (returns ``FeaturedTag``)."""
    norm = name.lower().lstrip("#")
    if not norm:
        raise HTTPException(status_code=422, detail="Validation failed: Name can't be blank")
    _ensure_featured(db, account.id, norm)
    db.commit()
    return _one_featured_tag(db, config, account, norm)


@router.delete("/api/v1/featured_tags/{tag_id}", status_code=200)
def featured_tag_delete(tag_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove one of the logged-in user's featured hashtags by its id."""
    try:
        row = db.get(FeaturedTag, int(tag_id))
    except (ValueError, TypeError):
        row = None
    if row is None or row.account_id != account.id:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(row)
    db.commit()
    return {}


# --- Single tag: fetch / follow / unfollow / feature / unfeature --------------


@router.get("/api/v1/tags/{hashtag}")
def tag(hashtag: str, db: DbSession, config: Config, account: CurrentAccount) -> dict[str, Any]:
    """Fetch a single hashtag by name."""
    name = hashtag.lower().lstrip("#")
    return _serialize(db, config, name, account.id if account else None)


@router.post("/api/v1/tags/{hashtag}/follow")
def tag_follow(hashtag: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Follow a hashtag (idempotent)."""
    name = hashtag.lower().lstrip("#")
    existing = db.scalar(
        select(FollowedTag).where(FollowedTag.account_id == account.id, FollowedTag.name == name)
    )
    if existing is None:
        db.add(FollowedTag(account_id=account.id, name=name))
        db.commit()
    return _serialize(db, config, name, account.id)


@router.post("/api/v1/tags/{hashtag}/unfollow")
def tag_unfollow(hashtag: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unfollow a hashtag (idempotent)."""
    name = hashtag.lower().lstrip("#")
    existing = db.scalar(
        select(FollowedTag).where(FollowedTag.account_id == account.id, FollowedTag.name == name)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return _serialize(db, config, name, account.id)


@router.post("/api/v1/tags/{hashtag}/feature")
def tag_feature(hashtag: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Feature a hashtag on the profile (newer alias; returns a ``Tag``)."""
    name = hashtag.lower().lstrip("#")
    _ensure_featured(db, account.id, name)
    db.commit()
    return _serialize(db, config, name, account.id)


@router.post("/api/v1/tags/{hashtag}/unfeature")
def tag_unfeature(hashtag: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unfeature a hashtag (newer alias; returns a ``Tag``)."""
    name = hashtag.lower().lstrip("#")
    existing = db.scalar(
        select(FeaturedTag).where(FeaturedTag.account_id == account.id, FeaturedTag.name == name)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return _serialize(db, config, name, account.id)


# --- helpers ------------------------------------------------------------------


def _ensure_featured(db: DbSession, account_id: int, name: str) -> FeaturedTag:
    """Find-or-create a featured-tag row for ``account_id`` + ``name``."""
    existing = db.scalar(
        select(FeaturedTag).where(FeaturedTag.account_id == account_id, FeaturedTag.name == name)
    )
    if existing is not None:
        return existing
    row = FeaturedTag(account_id=account_id, name=name)
    db.add(row)
    db.flush()
    return row


def _one_featured_tag(db: DbSession, config: Config, account: Account, name: str) -> dict[str, Any]:
    """Serialize a single ``FeaturedTag`` (the one matching ``name``) for ``account``."""
    for tag_data in featured_tags_for(db, config, account):
        if tag_data["name"] == name:
            return tag_data
    # Shouldn't happen (we just created it), but fall back to a minimal entry.
    return serialize_featured_tag(name, config, account_acct(account.username, account.domain))
