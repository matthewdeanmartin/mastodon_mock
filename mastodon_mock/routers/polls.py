"""Poll endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from mastodon_mock.db.models import Poll, PollVote
from mastodon_mock.deps import CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import parse_db_id
from mastodon_mock.serializers.polls import serialize_poll

router = APIRouter()


@router.get("/api/v1/polls/{poll_id}")
def get_poll(poll_id: str, db: DbSession, viewer: CurrentAccount) -> dict[str, Any]:
    """Fetch a poll."""
    poll = _poll_or_404(db, poll_id)
    return serialize_poll(db, poll, viewer)


@router.post("/api/v1/polls/{poll_id}/votes")
async def vote(poll_id: str, request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Cast votes on a poll for the authed user."""
    poll = _poll_or_404(db, poll_id)
    choices = await _choices(request)
    for choice in choices:
        try:
            position = int(choice)
        except (ValueError, TypeError):
            continue
        exists = db.scalar(
            select(PollVote).where(
                PollVote.poll_id == poll.id,
                PollVote.account_id == account.id,
                PollVote.option_position == position,
            )
        )
        if exists is None:
            db.add(PollVote(poll_id=poll.id, account_id=account.id, option_position=position))
    db.commit()
    return serialize_poll(db, poll, account)


async def _choices(request: Request) -> list[str]:
    """Extract ``choices[]`` from query or body."""
    ids = request.query_params.getlist("choices[]") or request.query_params.getlist("choices")
    if ids:
        return list(ids)
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            body = await request.json()
            return [str(v) for v in body.get("choices", [])]
        except Exception:
            return []
    try:
        form = await request.form()
        return [str(v) for v in form.getlist("choices[]")] or [str(v) for v in form.getlist("choices")]
    except Exception:
        return []


def _poll_or_404(db: DbSession, poll_id: str) -> Poll:
    """Fetch a poll or raise 404."""
    pid = parse_db_id(poll_id)
    poll = db.get(Poll, pid) if pid is not None else None
    if poll is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return poll
