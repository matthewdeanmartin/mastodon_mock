"""Serialize ``Status`` ORM rows to Mastodon ``Status`` JSON."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

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

if TYPE_CHECKING:
    from mastodon_mock.serializers.batch import BatchContext


_URL_RE = re.compile(r"https?://[^\s\"'<>]+")


def _count(session: Session, model: Any, **filters: Any) -> int:
    """Count rows of ``model`` matching equality ``filters``."""
    stmt = select(func.count()).select_from(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return session.scalar(stmt) or 0


def _preview_card(status: Status) -> dict[str, Any] | None:
    """Synthesize a deterministic dummy ``PreviewCard`` for the first link, if any.

    Real Mastodon builds cards by crawling the linked URL's OpenGraph tags; the
    mock can't (and shouldn't) fetch external URLs in a test fixture. Instead, when
    a status contains a link we return a fixed-shape, deterministic placeholder card
    pointing at that URL, so callers that read ``status.card`` get a correctly-shaped,
    non-``None`` object to assert on. Statuses with no link have ``card == None``,
    matching real Mastodon.
    """
    match = _URL_RE.search(status.content or "")
    if match is None:
        return None
    url = match.group(0)
    return {
        "url": url,
        "title": "Example link",
        "description": "A placeholder preview card synthesized by mastodon_mock.",
        "type": "link",
        "author_name": "",
        "author_url": "",
        "provider_name": "mastodon_mock",
        "provider_url": "",
        "html": "",
        "width": 0,
        "height": 0,
        "image": None,
        "embed_url": "",
        "blurhash": None,
    }


def _mentions_from_ctx(accounts: list[Account], config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Format already-loaded mention accounts to ``StatusMention`` JSON."""
    out = []
    for acc in accounts:
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


def _tags_from_names(names: list[str], config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Format already-loaded tag names to ``Tag`` JSON."""
    return [{"name": name, "url": f"https://{config.domain}/tags/{name}"} for name in names]


def _serialize_mentions(session: Session, status_id: int, config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Serialize a status's mentions to ``StatusMention`` JSON (single-row path)."""
    rows = (
        session.execute(
            select(Account)
            .join(StatusMention, StatusMention.account_id == Account.id)
            .where(StatusMention.status_id == status_id)
        )
        .scalars()
        .all()
    )
    return _mentions_from_ctx(list(rows), config)


def _serialize_tags(session: Session, status_id: int, config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Serialize a status's hashtags to ``Tag`` JSON (single-row path)."""
    names = session.execute(select(StatusTag.name).where(StatusTag.status_id == status_id)).scalars().all()
    return _tags_from_names(list(names), config)


def serialize_status_list(
    session: Session,
    statuses: list[Status],
    config: MastodonMockConfig,
    viewer: Account | None,
    *,
    filter_context: str | None = None,
) -> list[dict[str, Any]]:
    """Serialize a page of statuses with one batch of grouped queries (F1).

    Use this anywhere a list of statuses is serialized (timelines, account statuses,
    favourites/bookmarks, search, threads) instead of a per-row comprehension.
    """
    from mastodon_mock.serializers.batch import build_status_context

    # Reblog/quote targets are serialized inline (depth 1) by serialize_status. Fold them
    # into the same context (so their own engagement counts/flags/mentions/tags/media and
    # their authors' aggregates are all batched) and pass ``ctx`` down to the nested calls,
    # instead of letting each nested row fall back to the per-row query path (F2).
    nested_ids = {nid for s in statuses for nid in (s.reblog_of_id, s.quoted_status_id) if nid is not None}
    nested = list(session.scalars(select(Status).where(Status.id.in_(nested_ids))).all()) if nested_ids else []
    ctx = build_status_context(session, statuses + nested, viewer)
    out: list[dict[str, Any]] = []
    from mastodon_mock.moderation import account_is_discoverable

    for status in statuses:
        author = status.account or session.get(Account, status.account_id)
        if author is None or not account_is_discoverable(session, author, config, viewer):
            continue
        out.append(
            serialize_status(
                session,
                status,
                config,
                viewer,
                ctx=ctx,
                filter_context=filter_context,
            )
        )
    return out


def serialize_status(
    session: Session,
    status: Status,
    config: MastodonMockConfig,
    viewer: Account | None,
    *,
    _depth: int = 0,
    ctx: BatchContext | None = None,
    filter_context: str | None = None,
) -> dict[str, Any]:
    """Serialize a status, including viewer-relative flags and nested reblog.

    When ``ctx`` is supplied (built by :func:`serialize_status_list`), all per-status
    counts/flags/mentions/tags/media and the author's account aggregates come from
    precomputed batch data instead of per-row queries (F1). ``serialize_status_list``
    folds each page row's reblog/quote *target* into the same ``ctx``, so those nested
    rows read from the batch too rather than re-querying per row (F2).
    """
    account = status.account or session.get(Account, status.account_id)
    if account is None:
        raise RuntimeError(f"Account {status.account_id} not found for status {status.id}")
    acct = account_acct(account.username, account.domain)

    reblog_data = None
    if status.reblog_of_id is not None and _depth == 0:
        original = session.get(Status, status.reblog_of_id)
        if original is not None:
            reblog_data = serialize_status(
                session,
                original,
                config,
                viewer,
                _depth=_depth + 1,
                ctx=ctx,
                filter_context=filter_context,
            )

    if ctx is not None:
        media = ctx.media.get(status.id, [])
    else:
        media = list(
            session.execute(select(MediaAttachment).where(MediaAttachment.status_id == status.id)).scalars().all()
        )

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
                "quoted_status": (
                    None
                    if revoked
                    else serialize_status(
                        session,
                        quoted,
                        config,
                        viewer,
                        _depth=_depth + 1,
                        ctx=ctx,
                        filter_context=filter_context,
                    )
                ),
            }

    favourited = reblogged = bookmarked = muted = pinned = False
    if viewer is not None and ctx is not None:
        favourited = status.id in ctx.favourited
        bookmarked = status.id in ctx.bookmarked
        muted = status.id in ctx.muted
        pinned = status.id in ctx.pinned
        reblogged = status.id in ctx.reblogged
    elif viewer is not None:
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

    if ctx is not None:
        reblogs_count = ctx.reblogs_count.get(status.id, 0)
        favourites_count = ctx.favourites_count.get(status.id, 0)
        replies_count = ctx.replies_count.get(status.id, 0)
        mentions = _mentions_from_ctx(ctx.mentions.get(status.id, []), config)
        tags = _tags_from_names(ctx.tags.get(status.id, []), config)
    else:
        reblogs_count = _count(session, Status, reblog_of_id=status.id)
        favourites_count = _count(session, Favourite, status_id=status.id)
        replies_count = _count(session, Status, in_reply_to_id=status.id)
        mentions = _serialize_mentions(session, status.id, config)
        tags = _serialize_tags(session, status.id, config)

    data: dict[str, Any] = {
        "id": sid(status.id),
        "uri": status.url or status_url(config.domain, acct, status.id),
        "url": status.url or status_url(config.domain, acct, status.id),
        "account": serialize_account(session, account, config, ctx=ctx),
        "in_reply_to_id": sid(status.in_reply_to_id),
        "in_reply_to_account_id": sid(status.in_reply_to_account_id),
        "reblog": reblog_data,
        "content": status.content,
        "created_at": iso(status.created_at),
        "edited_at": iso(status.edited_at),
        "reblogs_count": reblogs_count,
        "favourites_count": favourites_count,
        "replies_count": replies_count,
        "reblogged": reblogged,
        "favourited": favourited,
        "bookmarked": bookmarked,
        "muted": muted,
        "pinned": pinned,
        "sensitive": status.sensitive or account.sensitized,
        "spoiler_text": status.spoiler_text,
        "visibility": status.visibility,
        "language": status.language,
        "mentions": mentions,
        "media_attachments": [serialize_media(m) for m in media],
        "emojis": [],
        "tags": tags,
        "card": _preview_card(status),
        "poll": poll_data,
        "application": application,
        "quote": quote_data,
        "quote_approval_policy": status.quote_approval_policy,
        "filtered": [],
    }
    if filter_context is not None:
        from mastodon_mock.content_filters import matches_for_status

        data["filtered"] = [match.result for match in matches_for_status(session, status, viewer, filter_context)]
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
