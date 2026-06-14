"""Conversation endpoints, derived from direct-visibility statuses."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import or_, select

from mastodon_mock.db.models import Account, ConversationRead, Status, StatusMention
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.serializers.misc import serialize_conversation
from mastodon_mock.serializers.statuses import serialize_status

router = APIRouter()


def _conversation_id(participant_ids: frozenset[int]) -> str:
    """Build a stable conversation id from a participant set."""
    return "-".join(str(i) for i in sorted(participant_ids))


@router.get("/api/v1/conversations")
@router.get("/api/v1/conversations/")
def conversations(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List direct-message conversations grouped by participant set."""
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

    read_ids = {
        r.conversation_id
        for r in db.scalars(select(ConversationRead).where(ConversationRead.account_id == account.id)).all()
    }

    out = []
    for key, last_status in grouped.items():
        conv_id = _conversation_id(key)
        other_ids = [i for i in key if i != account.id]
        accounts = [acc for i in other_ids if (acc := db.get(Account, i)) is not None]
        last = serialize_status(db, last_status, config, account)
        out.append(serialize_conversation(db, conv_id, accounts, last, conv_id not in read_ids, config))
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
