"""Shared service helpers used by routers and seeding.

Keeps relationship-edge bookkeeping, notification creation, and status text
parsing in one place so behaviour is consistent everywhere.
"""

from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import Account, Notification, Relationship, StatusMention, StatusTag, utcnow

_MENTION_RE = re.compile(r"@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9_.-]+)?)")
_HASHTAG_RE = re.compile(r"(?:^|\B)#(\w+)")


def get_or_create_relationship(session: Session, source_id: int, target_id: int) -> Relationship:
    """Fetch the (source → target) relationship row, creating a default one if absent."""
    rel = session.scalar(
        select(Relationship).where(
            Relationship.source_account_id == source_id,
            Relationship.target_account_id == target_id,
        )
    )
    if rel is None:
        rel = Relationship(source_account_id=source_id, target_account_id=target_id)
        session.add(rel)
        session.flush()
    return rel


def find_relationship(session: Session, source_id: int, target_id: int) -> Relationship | None:
    """Return the (source → target) relationship row or ``None``."""
    return session.scalar(
        select(Relationship).where(
            Relationship.source_account_id == source_id,
            Relationship.target_account_id == target_id,
        )
    )


def add_notification(
    session: Session,
    *,
    recipient_id: int,
    from_account_id: int,
    type_: str,
    status_id: int | None = None,
) -> Notification | None:
    """Create a notification, skipping self-actions (which never notify).

    Returns the created row (or ``None`` for a skipped self-action). The row is
    also appended to a per-session buffer (``session.info["stream_notifications"]``)
    so a router can stream it after commit via
    :func:`mastodon_mock.streaming_events.flush_stream_notifications`.
    """
    if recipient_id == from_account_id:
        return None
    notification = Notification(
        account_id=recipient_id,
        from_account_id=from_account_id,
        type=type_,
        status_id=status_id,
        created_at=utcnow(),
    )
    session.add(notification)
    session.info.setdefault("stream_notifications", []).append(notification)
    return notification


def do_follow(session: Session, follower: Account, target: Account) -> Relationship:
    """Apply a follow, honoring locked targets, and generate a notification.

    Returns the follower → target relationship row.
    """
    if follower.id == target.id:
        raise HTTPException(status_code=422, detail="Validation failed: You cannot follow yourself")

    forward = get_or_create_relationship(session, follower.id, target.id)
    backward = get_or_create_relationship(session, target.id, follower.id)

    if target.locked:
        if not forward.following and not forward.requested:
            forward.requested = True
            backward.requested_by = True
            add_notification(
                session,
                recipient_id=target.id,
                from_account_id=follower.id,
                type_="follow_request",
            )
    else:
        if not forward.following:
            forward.following = True
            backward.followed_by = True
            add_notification(
                session,
                recipient_id=target.id,
                from_account_id=follower.id,
                type_="follow",
            )
    return forward


def do_unfollow(session: Session, follower: Account, target: Account) -> Relationship:
    """Clear a follow/request edge in both directions."""
    forward = get_or_create_relationship(session, follower.id, target.id)
    backward = find_relationship(session, target.id, follower.id)
    forward.following = False
    forward.requested = False
    if backward is not None:
        backward.followed_by = False
        backward.requested_by = False
    return forward


def parse_mentions(session: Session, text: str, exclude_account_id: int) -> list[Account]:
    """Resolve ``@username`` / ``@username@domain`` mentions in ``text`` to accounts."""
    found: dict[int, Account] = {}
    for raw in _MENTION_RE.findall(text):
        username, _, domain = raw.partition("@")
        stmt = select(Account).where(Account.username == username)
        stmt = stmt.where(Account.domain == (domain or None))
        account = session.scalar(stmt)
        if account is not None and account.id != exclude_account_id:
            found[account.id] = account
    return list(found.values())


def parse_hashtags(text: str) -> list[str]:
    """Return lowercased hashtag names (without ``#``) found in ``text``."""
    seen: list[str] = []
    for name in _HASHTAG_RE.findall(text):
        lowered = name.lower()
        if lowered not in seen:
            seen.append(lowered)
    return seen


def attach_mentions_and_tags(session: Session, status_id: int, account_id: int, text: str) -> list[Account]:
    """Persist mention + tag edges for a status and return mentioned accounts."""
    mentioned = parse_mentions(session, text, exclude_account_id=account_id)
    for account in mentioned:
        session.add(StatusMention(status_id=status_id, account_id=account.id))
    for name in parse_hashtags(text):
        session.add(StatusTag(status_id=status_id, name=name))
    return mentioned
