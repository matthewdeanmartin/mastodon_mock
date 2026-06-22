"""Search endpoints (v1 + v2). Local-only, no webfinger resolve."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy import or_, select

from mastodon_mock.db.models import Account, Status, StatusTag
from mastodon_mock.deps import Config, CurrentAccount, DbSession
from mastodon_mock.pagination import clamp_limit
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.statuses import serialize_status_list

router = APIRouter(tags=["search"])


def _do_search(
    db: DbSession, config: Config, viewer: Account | None, q: str, limit: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Run a local search and return (accounts, statuses, hashtags)."""
    # Clamp the client-supplied limit: Mastodon caps search results, and an unbounded
    # value would overflow SQLite's INTEGER when passed to .limit(). See pagination.
    limit = clamp_limit(limit)
    term = q.strip()
    like = f"%{term.lstrip('@#')}%"

    accounts = db.scalars(
        select(Account).where(or_(Account.username.ilike(like), Account.display_name.ilike(like))).limit(limit)
    ).all()

    statuses = db.scalars(
        select(Status).where(Status.content.ilike(like)).order_by(Status.id.desc()).limit(limit)
    ).all()

    tag_names = db.scalars(
        select(StatusTag.name)
        .where(StatusTag.name.ilike(term.lstrip("#").lower() + "%"))
        .group_by(StatusTag.name)
        .limit(limit)
    ).all()

    from mastodon_mock.moderation import account_is_discoverable

    accounts_data = [
        serialize_account(db, account, config)
        for account in accounts
        if account_is_discoverable(db, account, config, viewer)
    ]
    statuses_data = serialize_status_list(db, list(statuses), config, viewer, filter_context="public")
    hashtags_data = [{"name": name, "url": f"https://{config.domain}/tags/{name}", "history": []} for name in tag_names]
    return accounts_data, statuses_data, hashtags_data


@router.get("/api/v2/search")
def search_v2(
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    q: str,
    type: str | None = None,
    limit: int = 20,
    resolve: bool = False,
    offset: int = 0,
) -> dict[str, Any]:
    """Return ``SearchV2`` (accounts / statuses / hashtags)."""
    accounts, statuses, hashtags = _do_search(db, config, viewer, q, limit)
    if type == "accounts":
        statuses, hashtags = [], []
    elif type == "statuses":
        accounts, hashtags = [], []
    elif type == "hashtags":
        accounts, statuses = [], []
    return {"accounts": accounts, "statuses": statuses, "hashtags": hashtags}


@router.get("/api/v1/search")
def search_v1(
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    q: str,
    limit: int = 20,
    resolve: bool = False,
    offset: int = 0,
) -> dict[str, Any]:
    """Return v1 ``Search`` (hashtags as strings)."""
    accounts, statuses, hashtags = _do_search(db, config, viewer, q, limit)
    return {
        "accounts": accounts,
        "statuses": statuses,
        "hashtags": [h["name"] for h in hashtags],
    }
