"""Serialize ``Relationship`` rows (and the all-false default)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import Account, DomainBlock, Relationship
from mastodon_mock.serializers.common import iso, sid


def _domain_blocking(session: Session, source_id: int, target: Account | None) -> bool:
    """Whether ``source`` blocks the target account's domain."""
    if target is None or target.domain is None:
        return False
    return (
        session.scalar(
            select(func.count())
            .select_from(DomainBlock)
            .where(DomainBlock.account_id == source_id, DomainBlock.domain == target.domain)
        )
        or 0
    ) > 0


def serialize_relationship(
    session: Session,
    target_id: int,
    rel: Relationship | None,
    *,
    source_id: int | None = None,
) -> dict[str, Any]:
    """Serialize a relationship toward ``target_id``; ``None`` → all-false."""
    target = session.get(Account, target_id)
    domain_blocking = False
    if source_id is not None:
        domain_blocking = _domain_blocking(session, source_id, target)

    if rel is None:
        return {
            "id": sid(target_id),
            "following": False,
            "followed_by": False,
            "blocking": False,
            "blocked_by": False,
            "muting": False,
            "muting_notifications": False,
            "requested": False,
            "requested_by": False,
            "domain_blocking": domain_blocking,
            "showing_reblogs": True,
            "endorsed": False,
            "notifying": False,
            "languages": None,
            "note": "",
            "muting_expires_at": None,
        }

    return {
        "id": sid(target_id),
        "following": rel.following,
        "followed_by": rel.followed_by,
        "blocking": rel.blocking,
        "blocked_by": rel.blocked_by,
        "muting": rel.muting,
        "muting_notifications": rel.muting_notifications,
        "requested": rel.requested,
        "requested_by": rel.requested_by,
        "domain_blocking": domain_blocking,
        "showing_reblogs": rel.showing_reblogs,
        "endorsed": rel.endorsed,
        "notifying": rel.notifying,
        "languages": rel.languages,
        "note": rel.note,
        "muting_expires_at": iso(rel.muting_expires_at),
    }
