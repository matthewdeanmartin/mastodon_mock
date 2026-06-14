"""Serialize ``Poll`` rows, computing vote tallies."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import Account, Poll, PollVote
from mastodon_mock.serializers.common import iso, sid


def serialize_poll(session: Session, poll: Poll, viewer: Account | None) -> dict[str, Any]:
    """Serialize a poll, including the viewer's own votes if authenticated."""
    counts_by_pos: dict[int, int] = {}
    for position, count in session.execute(
        select(PollVote.option_position, func.count())
        .where(PollVote.poll_id == poll.id)
        .group_by(PollVote.option_position)
    ).all():
        counts_by_pos[position] = count

    voters_count = (
        session.scalar(select(func.count(func.distinct(PollVote.account_id))).where(PollVote.poll_id == poll.id)) or 0
    )

    options = [{"title": opt.title, "votes_count": counts_by_pos.get(opt.position, 0)} for opt in poll.options]
    votes_count = sum(counts_by_pos.values())

    own_votes: list[int] = []
    voted = False
    if viewer is not None:
        own_votes = [
            pos
            for (pos,) in session.execute(
                select(PollVote.option_position).where(PollVote.poll_id == poll.id, PollVote.account_id == viewer.id)
            ).all()
        ]
        voted = bool(own_votes)

    return {
        "id": sid(poll.id),
        "expires_at": iso(poll.expires_at),
        "expired": poll.expired,
        "multiple": poll.multiple,
        "votes_count": votes_count,
        "voters_count": voters_count,
        "options": options,
        "emojis": [],
        "voted": voted,
        "own_votes": own_votes,
    }
