"""Batch-precompute the per-row aggregates the status/account serializers need.

The single-row serializers (``serialize_status`` / ``serialize_account``) issue a
handful of ``COUNT``/``EXISTS`` queries each. That's fine for one row but is an N+1 when
serializing a timeline page (~16 queries x 20 statuses). This module computes all of
those aggregates for a *page* of statuses in a small, constant number of grouped
queries, and the serializers read from the resulting :class:`BatchContext` instead of
querying per-row. See spec/09-sample-data-and-perf.md finding F1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import (
    Account,
    Bookmark,
    Favourite,
    MediaAttachment,
    Pin,
    Status,
    StatusMention,
    StatusMute,
    StatusTag,
)


@dataclass
class BatchContext:
    """Precomputed aggregates for a page of statuses (and their authors).

    Every mapping is keyed by the relevant id; ``.get(id, default)`` yields the same
    value the single-row serializer would have computed, so a present-but-empty context
    is always safe.
    """

    # status_id -> count
    reblogs_count: dict[int, int] = field(default_factory=dict)
    favourites_count: dict[int, int] = field(default_factory=dict)
    replies_count: dict[int, int] = field(default_factory=dict)
    # status_id -> bool (viewer-relative)
    favourited: set[int] = field(default_factory=set)
    bookmarked: set[int] = field(default_factory=set)
    muted: set[int] = field(default_factory=set)
    pinned: set[int] = field(default_factory=set)
    reblogged: set[int] = field(default_factory=set)
    # status_id -> list of rows
    mentions: dict[int, list[Account]] = field(default_factory=dict)
    tags: dict[int, list[str]] = field(default_factory=dict)
    media: dict[int, list[MediaAttachment]] = field(default_factory=dict)
    # account_id -> count (account serializer)
    followers_count: dict[int, int] = field(default_factory=dict)
    following_count: dict[int, int] = field(default_factory=dict)
    statuses_count: dict[int, int] = field(default_factory=dict)
    last_status_at: dict[int, datetime | None] = field(default_factory=dict)

    # Flags so the serializers know whether a given account's aggregates were
    # precomputed (vs. an account not in this page, which must fall back to querying).
    accounts_loaded: set[int] = field(default_factory=set)

    # Memo of already-serialized account dicts, keyed by account id. An account's
    # serialized JSON is a pure function of (account row, config, ctx) — all stable
    # within one page — so authors that recur across a page (every row of an
    # account_statuses page; repeated authors in a home timeline) are serialized once.
    account_json: dict[int, dict[str, Any]] = field(default_factory=dict)


def build_status_context(
    session: Session,
    statuses: list[Status],
    viewer: Account | None,
) -> BatchContext:
    """Compute a :class:`BatchContext` for ``statuses`` in a constant # of queries."""
    ctx = BatchContext()
    if not statuses:
        return ctx

    status_ids = [s.id for s in statuses]
    account_ids = {s.account_id for s in statuses}

    _load_status_counts(session, status_ids, ctx)
    if viewer is not None:
        _load_viewer_flags(session, status_ids, viewer.id, ctx)
    _load_mentions(session, status_ids, ctx)
    _load_tags(session, status_ids, ctx)
    _load_media(session, status_ids, ctx)
    _load_account_aggregates(session, account_ids, ctx)

    return ctx


def build_account_context(session: Session, accounts: list[Account]) -> BatchContext:
    """Compute a :class:`BatchContext` covering just the account-level aggregates."""
    ctx = BatchContext()
    _load_account_aggregates(session, {a.id for a in accounts}, ctx)
    return ctx


# --- status-level ----------------------------------------------------------------


def _load_status_counts(session: Session, status_ids: list[int], ctx: BatchContext) -> None:
    """reblogs/favourites/replies counts, grouped by the target status id."""
    for status_id, count in session.execute(
        select(Status.reblog_of_id, func.count())
        .where(Status.reblog_of_id.in_(status_ids))
        .group_by(Status.reblog_of_id)
    ).all():
        ctx.reblogs_count[status_id] = count

    for status_id, count in session.execute(
        select(Favourite.status_id, func.count())
        .where(Favourite.status_id.in_(status_ids))
        .group_by(Favourite.status_id)
    ).all():
        ctx.favourites_count[status_id] = count

    for status_id, count in session.execute(
        select(Status.in_reply_to_id, func.count())
        .where(Status.in_reply_to_id.in_(status_ids))
        .group_by(Status.in_reply_to_id)
    ).all():
        ctx.replies_count[status_id] = count


def _load_viewer_flags(session: Session, status_ids: list[int], viewer_id: int, ctx: BatchContext) -> None:
    """favourited/bookmarked/muted/pinned/reblogged for the viewer, as sets."""
    ctx.favourited.update(
        session.scalars(
            select(Favourite.status_id).where(Favourite.account_id == viewer_id, Favourite.status_id.in_(status_ids))
        ).all()
    )
    ctx.bookmarked.update(
        session.scalars(
            select(Bookmark.status_id).where(Bookmark.account_id == viewer_id, Bookmark.status_id.in_(status_ids))
        ).all()
    )
    ctx.muted.update(
        session.scalars(
            select(StatusMute.status_id).where(StatusMute.account_id == viewer_id, StatusMute.status_id.in_(status_ids))
        ).all()
    )
    ctx.pinned.update(
        session.scalars(select(Pin.status_id).where(Pin.account_id == viewer_id, Pin.status_id.in_(status_ids))).all()
    )
    ctx.reblogged.update(
        [
            rid
            for rid in session.scalars(
                select(Status.reblog_of_id).where(Status.account_id == viewer_id, Status.reblog_of_id.in_(status_ids))
            ).all()
            if rid is not None
        ]
    )


def _load_mentions(session: Session, status_ids: list[int], ctx: BatchContext) -> None:
    """All mentioned accounts per status, in one join."""
    rows = session.execute(
        select(StatusMention.status_id, Account)
        .join(Account, Account.id == StatusMention.account_id)
        .where(StatusMention.status_id.in_(status_ids))
    ).all()
    for status_id, account in rows:
        ctx.mentions.setdefault(status_id, []).append(account)


def _load_tags(session: Session, status_ids: list[int], ctx: BatchContext) -> None:
    """All tag names per status."""
    for status_id, name in session.execute(
        select(StatusTag.status_id, StatusTag.name).where(StatusTag.status_id.in_(status_ids))
    ).all():
        ctx.tags.setdefault(status_id, []).append(name)


def _load_media(session: Session, status_ids: list[int], ctx: BatchContext) -> None:
    """All media attachments per status."""
    rows = session.scalars(select(MediaAttachment).where(MediaAttachment.status_id.in_(status_ids))).all()
    for media in rows:
        if media.status_id is not None:
            ctx.media.setdefault(media.status_id, []).append(media)


# --- account-level ---------------------------------------------------------------


def _load_account_aggregates(session: Session, account_ids: set[int], ctx: BatchContext) -> None:
    """followers/following/statuses counts + last_status_at, grouped by account."""
    if not account_ids:
        return
    ids = list(account_ids)
    ctx.accounts_loaded.update(ids)

    from mastodon_mock.db.models import Relationship

    for account_id, count in session.execute(
        select(Relationship.target_account_id, func.count())
        .where(Relationship.target_account_id.in_(ids), Relationship.following.is_(True))
        .group_by(Relationship.target_account_id)
    ).all():
        ctx.followers_count[account_id] = count

    for account_id, count in session.execute(
        select(Relationship.source_account_id, func.count())
        .where(Relationship.source_account_id.in_(ids), Relationship.following.is_(True))
        .group_by(Relationship.source_account_id)
    ).all():
        ctx.following_count[account_id] = count

    for account_id, count in session.execute(
        select(Status.account_id, func.count())
        .where(Status.account_id.in_(ids), Status.visibility != "direct")
        .group_by(Status.account_id)
    ).all():
        ctx.statuses_count[account_id] = count

    for account_id, last in session.execute(
        select(Status.account_id, func.max(Status.created_at))
        .where(Status.account_id.in_(ids))
        .group_by(Status.account_id)
    ).all():
        ctx.last_status_at[account_id] = last
