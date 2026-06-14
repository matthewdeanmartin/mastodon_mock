"""Serialize ``Account`` ORM rows to Mastodon ``Account`` JSON."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Relationship, Status
from mastodon_mock.serializers.common import (
    account_acct,
    iso,
    placeholder_avatar,
    placeholder_header,
    profile_url,
    sid,
)


def _followers_count(session: Session, account_id: int) -> int:
    """Count accounts that follow ``account_id``."""
    return (
        session.scalar(
            select(func.count())
            .select_from(Relationship)
            .where(Relationship.target_account_id == account_id, Relationship.following.is_(True))
        )
        or 0
    )


def _following_count(session: Session, account_id: int) -> int:
    """Count accounts ``account_id`` follows."""
    return (
        session.scalar(
            select(func.count())
            .select_from(Relationship)
            .where(Relationship.source_account_id == account_id, Relationship.following.is_(True))
        )
        or 0
    )


def _statuses_count(session: Session, account_id: int) -> int:
    """Count non-direct statuses authored by ``account_id``."""
    return (
        session.scalar(
            select(func.count())
            .select_from(Status)
            .where(Status.account_id == account_id, Status.visibility != "direct")
        )
        or 0
    )


def _last_status_at(session: Session, account_id: int) -> Any:
    """Return the timestamp of the account's most recent status, or ``None``."""
    return session.scalar(select(func.max(Status.created_at)).where(Status.account_id == account_id))


def serialize_account(
    session: Session,
    account: Account,
    config: MastodonMockConfig,
    *,
    with_source: bool = False,
) -> dict[str, Any]:
    """Serialize an account. Set ``with_source`` for ``verify_credentials``."""
    acct = account_acct(account.username, account.domain)
    url = profile_url(config.domain, acct)
    avatar = account.avatar_url or placeholder_avatar(config.domain)
    header = account.header_url or placeholder_header(config.domain)

    data: dict[str, Any] = {
        "id": sid(account.id),
        "username": account.username,
        "acct": acct,
        "display_name": account.display_name,
        "locked": account.locked,
        "bot": account.bot,
        "discoverable": account.discoverable,
        "group": account.group,
        "created_at": iso(account.created_at),
        "note": account.note,
        "url": url,
        "uri": url,
        "avatar": avatar,
        "avatar_static": avatar,
        "header": header,
        "header_static": header,
        "followers_count": _followers_count(session, account.id),
        "following_count": _following_count(session, account.id),
        "statuses_count": _statuses_count(session, account.id),
        "last_status_at": iso(_last_status_at(session, account.id)),
        "emojis": [],
        "fields": account.fields or [],
        "indexable": account.indexable,
        "hide_collections": account.hide_collections,
        "noindex": None,
        "roles": [],
        "moved": None,
        "suspended": None,
        "limited": None,
    }

    if with_source:
        follow_requests_count = (
            session.scalar(
                select(func.count())
                .select_from(Relationship)
                .where(Relationship.target_account_id == account.id, Relationship.requested_by.is_(True))
            )
            or 0
        )
        data["source"] = {
            "privacy": account.default_privacy,
            "sensitive": account.default_sensitive,
            "language": account.default_language,
            "note": account.note,
            "fields": account.fields or [],
            "follow_requests_count": follow_requests_count,
            "discoverable": account.discoverable,
            "indexable": account.indexable,
            "hide_collections": account.hide_collections,
        }
        data["role"] = None

    return data
