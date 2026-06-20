"""Conversation endpoints, derived from direct-visibility statuses."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy import or_, select

from mastodon_mock.db.models import Account, ConversationRead, Status, StatusMention
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.pagination import Page, clamp_limit, coerce_cursor, link_header, parse_db_id
from mastodon_mock.routers.helpers import PageQuery
from mastodon_mock.serializers.misc import serialize_conversation
from mastodon_mock.serializers.statuses import serialize_status

router = APIRouter()


def _conversation_id(last_status_id: int) -> str:
    """Derive the conversation id from its latest status.

    Real Mastodon conversation ids are plain numeric snowflake ids, sortable
    as integers — clients (e.g. mastui) rely on ``int(conversation_id)`` to
    track the newest conversation. A composite id (e.g. participant ids
    joined with ``-``) breaks that contract, so this mirrors the latest
    status id instead, which is already a real numeric id.
    """
    return str(last_status_id)


@router.get("/api/v1/conversations")
@router.get("/api/v1/conversations/")
def conversations(
    request: Request, response: Response, db: DbSession, config: Config, account: RequiredAccount, params: PageQuery
) -> list[dict[str, Any]]:
    """List direct-message conversations grouped by participant set, newest first.

    Grouping happens before pagination: each conversation is represented by its
    latest status, and ``max_id``/``min_id``/``since_id``/``limit`` page over that
    per-conversation list (not the raw status rows) — otherwise a client paging
    through results sees the same conversations repeated rather than advancing.
    """
    # Direct statuses where the user is the author or a mentioned participant.
    mentioned_status_ids = select(StatusMention.status_id).where(StatusMention.account_id == account.id)
    statuses = db.scalars(
        select(Status)
        .where(
            Status.visibility == "direct",
            or_(Status.account_id == account.id, Status.id.in_(mentioned_status_ids)),
        )
        .order_by(Status.id.desc())
    ).all()

    grouped: dict[frozenset[int], Status] = {}
    for status in statuses:
        participants = {status.account_id}
        for (acc_id,) in db.execute(select(StatusMention.account_id).where(StatusMention.status_id == status.id)).all():
            participants.add(acc_id)
        key = frozenset(participants)
        if key not in grouped:  # statuses are newest-first, so first seen is latest
            grouped[key] = status

    # Conversations newest-first by their representative (latest) status id.
    conversation_items = sorted(grouped.items(), key=lambda kv: kv[1].id, reverse=True)

    max_id = coerce_cursor(params.max_id)
    min_id = coerce_cursor(params.min_id)
    since_id = coerce_cursor(params.since_id)
    if max_id is not None:
        conversation_items = [(k, s) for k, s in conversation_items if s.id < max_id]
    if since_id is not None:
        conversation_items = [(k, s) for k, s in conversation_items if s.id > since_id]
    using_min_id = min_id is not None
    if min_id is not None:
        conversation_items = [(k, s) for k, s in conversation_items if s.id > min_id]
        conversation_items.reverse()  # oldest-first while slicing, restored below

    limit = clamp_limit(params.limit)
    has_more = len(conversation_items) > limit
    page_items = conversation_items[:limit]
    if using_min_id:
        page_items.reverse()

    read_ids = {
        r.conversation_id
        for r in db.scalars(select(ConversationRead).where(ConversationRead.account_id == account.id)).all()
    }

    out = []
    for key, last_status in page_items:
        conv_id = _conversation_id(last_status.id)
        other_ids = [i for i in key if i != account.id]
        accounts = [acc for i in other_ids if (acc := db.get(Account, i)) is not None]
        last = serialize_status(db, last_status, config, account, filter_context="notifications")
        out.append(serialize_conversation(db, conv_id, accounts, last, conv_id not in read_ids, config))

    page = Page(
        items=[s for _, s in page_items],
        limit=limit,
        first_id=page_items[0][1].id if page_items else None,
        last_id=page_items[-1][1].id if page_items else None,
        has_more=has_more,
    )
    base = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
    header = link_header(base, page)
    if header:
        response.headers["Link"] = header
    return out


@router.post("/api/v1/conversations/{conversation_id}/read", status_code=200)
def read_conversation(conversation_id: str, db: DbSession, account: RequiredAccount, config: Config) -> dict[str, Any]:
    """Mark a conversation as read."""
    exists = db.scalar(
        select(ConversationRead).where(
            ConversationRead.account_id == account.id,
            ConversationRead.conversation_id == conversation_id,
        )
    )
    if exists is None:
        db.add(ConversationRead(account_id=account.id, conversation_id=conversation_id))
    db.commit()
    return {"id": conversation_id, "unread": False, "accounts": [], "last_status": None}


@router.delete("/api/v1/conversations/{conversation_id}", status_code=200)
def delete_conversation(conversation_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a conversation (its representative latest status, plus the read marker)."""
    status_id = parse_db_id(conversation_id)
    if status_id is not None:
        status = db.get(Status, status_id)
        if status is not None:
            db.delete(status)
    exists = db.scalar(
        select(ConversationRead).where(
            ConversationRead.account_id == account.id,
            ConversationRead.conversation_id == conversation_id,
        )
    )
    if exists is not None:
        db.delete(exists)
    db.commit()
    return {}
