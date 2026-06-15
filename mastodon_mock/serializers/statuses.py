"""Serialize ``Status`` ORM rows to Mastodon ``Status`` JSON."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import (
    Account,
    Bookmark,
    Favourite,
    MediaAttachment,
    OAuthApp,
    Pin,
    Poll,
    Status,
    StatusMention,
    StatusMute,
    StatusTag,
)
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import account_acct, iso, sid, status_url
from mastodon_mock.serializers.media import serialize_media
from mastodon_mock.serializers.polls import serialize_poll


def _count(session: Session, model: Any, **filters: Any) -> int:
    """Count rows of ``model`` matching equality ``filters``."""
    stmt = select(func.count()).select_from(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return session.scalar(stmt) or 0


def _serialize_mentions(session: Session, status_id: int, config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Serialize a status's mentions to ``StatusMention`` JSON."""
    rows = (
        session.execute(
            select(Account)
            .join(StatusMention, StatusMention.account_id == Account.id)
            .where(StatusMention.status_id == status_id)
        )
        .scalars()
        .all()
    )
    out = []
    for acc in rows:
        acct = account_acct(acc.username, acc.domain)
        out.append(
            {
                "id": sid(acc.id),
                "username": acc.username,
                "acct": acct,
                "url": f"https://{config.domain}/@{acct}",
            }
        )
    return out


def _serialize_tags(session: Session, status_id: int, config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Serialize a status's hashtags to ``Tag`` JSON."""
    names = session.execute(select(StatusTag.name).where(StatusTag.status_id == status_id)).scalars().all()
    return [{"name": name, "url": f"https://{config.domain}/tags/{name}"} for name in names]


def serialize_status(
    session: Session,
    status: Status,
    config: MastodonMockConfig,
    viewer: Account | None,
    *,
    _depth: int = 0,
) -> dict[str, Any]:
    """Serialize a status, including viewer-relative flags and nested reblog."""
    account = status.account or session.get(Account, status.account_id)
    assert account is not None  # account_id is a required FK
    acct = account_acct(account.username, account.domain)

    reblog_data = None
    if status.reblog_of_id is not None and _depth == 0:
        original = session.get(Status, status.reblog_of_id)
        if original is not None:
            reblog_data = serialize_status(session, original, config, viewer, _depth=_depth + 1)

    media = session.execute(select(MediaAttachment).where(MediaAttachment.status_id == status.id)).scalars().all()

    poll_data = None
    if status.poll_id is not None:
        poll = session.get(Poll, status.poll_id)
        if poll is not None:
            poll_data = serialize_poll(session, poll, viewer)

    application = None
    if status.application_id is not None:
        app = session.get(OAuthApp, status.application_id)
        if app is not None:
            application = {"name": app.name, "website": app.website}

    quote_data = None
    if status.quoted_status_id is not None and _depth == 0:
        quoted = session.get(Status, status.quoted_status_id)
        if quoted is not None:
            # A revoked quote hides the quoted status (matching real Mastodon).
            revoked = status.quote_state == "revoked"
            quote_data = {
                "state": status.quote_state,
                "quoted_status": None
                if revoked
                else serialize_status(session, quoted, config, viewer, _depth=_depth + 1),
            }

    favourited = reblogged = bookmarked = muted = pinned = False
    if viewer is not None:
        favourited = _count(session, Favourite, account_id=viewer.id, status_id=status.id) > 0
        bookmarked = _count(session, Bookmark, account_id=viewer.id, status_id=status.id) > 0
        muted = _count(session, StatusMute, account_id=viewer.id, status_id=status.id) > 0
        pinned = _count(session, Pin, account_id=viewer.id, status_id=status.id) > 0
        reblogged = (
            session.scalar(
                select(func.count())
                .select_from(Status)
                .where(Status.reblog_of_id == status.id, Status.account_id == viewer.id)
            )
            or 0
        ) > 0

    data: dict[str, Any] = {
        "id": sid(status.id),
        "uri": status.url or status_url(config.domain, acct, status.id),
        "url": status.url or status_url(config.domain, acct, status.id),
        "account": serialize_account(session, account, config),
        "in_reply_to_id": sid(status.in_reply_to_id),
        "in_reply_to_account_id": sid(status.in_reply_to_account_id),
        "reblog": reblog_data,
        "content": status.content,
        "created_at": iso(status.created_at),
        "edited_at": iso(status.edited_at),
        "reblogs_count": _count(session, Status, reblog_of_id=status.id),
        "favourites_count": _count(session, Favourite, status_id=status.id),
        "replies_count": _count(session, Status, in_reply_to_id=status.id),
        "reblogged": reblogged,
        "favourited": favourited,
        "bookmarked": bookmarked,
        "muted": muted,
        "pinned": pinned,
        "sensitive": status.sensitive,
        "spoiler_text": status.spoiler_text,
        "visibility": status.visibility,
        "language": status.language,
        "mentions": _serialize_mentions(session, status.id, config),
        "media_attachments": [serialize_media(m) for m in media],
        "emojis": [],
        "tags": _serialize_tags(session, status.id, config),
        "card": None,
        "poll": poll_data,
        "application": application,
        "quote": quote_data,
        "quote_approval_policy": status.quote_approval_policy,
        "filtered": [],
    }
    return data


def serialize_status_source(status: Status) -> dict[str, Any]:
    """Serialize a status's editable source (``status_source``)."""
    return {
        "id": sid(status.id),
        "text": status.text,
        "spoiler_text": status.spoiler_text,
    }


def serialize_status_edit(snapshot: dict[str, Any], account_data: dict[str, Any]) -> dict[str, Any]:
    """Serialize a single history snapshot into a ``StatusEdit`` shape."""
    return {
        "content": snapshot.get("content", ""),
        "spoiler_text": snapshot.get("spoiler_text", ""),
        "sensitive": snapshot.get("sensitive", False),
        "created_at": snapshot.get("created_at"),
        "account": account_data,
        "media_attachments": snapshot.get("media_attachments", []),
        "emojis": [],
        "poll": snapshot.get("poll"),
    }
