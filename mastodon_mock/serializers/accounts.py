"""Serialize ``Account`` ORM rows to Mastodon ``Account`` JSON."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

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

if TYPE_CHECKING:
    from mastodon_mock.serializers.batch import BatchContext


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
    ctx: BatchContext | None = None,
) -> dict[str, Any]:
    """Serialize an account. Set ``with_source`` for ``verify_credentials``.

    When ``ctx`` is supplied and covers this account, the follower/following/status
    counts come from precomputed batch aggregates instead of per-row queries (F1),
    and the finished dict is memoized per page so a recurring author (e.g. every row
    of an ``account_statuses`` page) is serialized only once.
    """
    # The cached dict is the base Account shape; the ``with_source`` variant adds
    # fields and an extra query and is never serialized in a list, so skip the memo.
    if ctx is not None and not with_source:
        cached = ctx.account_json.get(account.id)
        if cached is not None:
            return cached

    acct = account_acct(account.username, account.domain)
    url = profile_url(config.domain, acct)
    avatar = account.avatar_url or placeholder_avatar(config.domain, acct)
    header = account.header_url or placeholder_header(config.domain, acct)

    if ctx is not None and account.id in ctx.accounts_loaded:
        followers = ctx.followers_count.get(account.id, 0)
        following = ctx.following_count.get(account.id, 0)
        statuses = ctx.statuses_count.get(account.id, 0)
        last_status = ctx.last_status_at.get(account.id)
    else:
        followers = _followers_count(session, account.id)
        following = _following_count(session, account.id)
        statuses = _statuses_count(session, account.id)
        last_status = _last_status_at(session, account.id)

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
        "followers_count": followers,
        "following_count": following,
        "statuses_count": statuses,
        "last_status_at": iso(last_status),
        "emojis": [],
        "fields": account.fields or [],
        "indexable": account.indexable,
        "hide_collections": account.hide_collections,
        "noindex": None,
        "roles": [],
        "moved": None,
        "suspended": account.suspended or None,
        "limited": account.silenced or None,
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
        data["role"] = _credential_role(account.role)
        # with_source variant is request-specific; never memoized.
        return data

    if ctx is not None:
        ctx.account_json[account.id] = data

    return data


# Coarse role → Role-entity mapping for CredentialAccount.role. Mirrors the admin
# serializer's table but kept local to avoid an import cycle (admin imports this module).
# Non-staff accounts have no elevated role, which Mastodon reports as null here.
_STAFF_ROLE_IDS = {"moderator": "1", "admin": "3", "owner": "0"}


def _credential_role(role: str) -> dict[str, Any] | None:
    """The ``Role`` entity for ``verify_credentials``; ``None`` for ordinary users."""
    if role not in _STAFF_ROLE_IDS:
        return None
    return {
        "id": _STAFF_ROLE_IDS[role],
        "name": role.capitalize(),
        "permissions": "1048575" if role in ("admin", "owner") else "65536",
        "color": "",
        "highlighted": True,
    }
