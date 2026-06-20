"""Timeline endpoints. See spec/03-api-coverage.md "timelines"."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import or_, select

from mastodon_mock.db.models import Account, Relationship, Status, StatusMention, StatusTag, UserList, UserListAccount
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, set_link_header
from mastodon_mock.serializers.statuses import serialize_status_list

router = APIRouter()

_PUBLIC_VISIBILITIES = ("public",)


@router.get("/api/v1/timelines/home")
def timeline_home(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Statuses from followed accounts + own statuses, newest first."""
    followed_ids = [
        r.target_account_id
        for r in db.scalars(
            select(Relationship).where(Relationship.source_account_id == account.id, Relationship.following.is_(True))
        ).all()
    ]
    author_ids = [*followed_ids, account.id]
    query = select(Status).where(
        Status.account_id.in_(author_ids),
        Status.visibility != "direct",
    )
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, account)


@router.get("/api/v1/timelines/public")
def timeline_public(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    params: PageQuery,
    local: bool = False,
    remote: bool = False,
    only_media: bool = False,
) -> list[dict[str, Any]]:
    """All public statuses; ``local``/``remote`` filter by domain."""
    query = select(Status).where(
        Status.visibility.in_(_PUBLIC_VISIBILITIES),
        Status.reblog_of_id.is_(None),
    )
    if local:
        query = query.where(Status.account_id.in_(select(Account.id).where(Account.domain.is_(None))))
    if remote:
        query = query.where(Status.account_id.in_(select(Account.id).where(Account.domain.is_not(None))))

    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, viewer)


@router.get("/api/v1/timelines/tag/{hashtag}")
def timeline_hashtag(
    hashtag: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Public statuses tagged with the given hashtag."""
    query = select(Status).where(
        Status.visibility.in_(_PUBLIC_VISIBILITIES),
        Status.id.in_(select(StatusTag.status_id).where(StatusTag.name == hashtag.lower())),
    )
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, viewer)


@router.get("/api/v1/timelines/list/{list_id}")
def timeline_list(
    list_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Statuses from accounts in the given list."""
    try:
        ul = db.get(UserList, int(list_id))
    except (ValueError, TypeError):
        ul = None
    if ul is None:
        raise HTTPException(status_code=404, detail="Record not found")
    member_ids = select(UserListAccount.account_id).where(UserListAccount.list_id == ul.id)
    query = select(Status).where(Status.account_id.in_(member_ids), Status.visibility != "direct")
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, account)


@router.get("/api/v1/timelines/direct")
def timeline_direct(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Direct-message statuses involving the authed account, newest first."""
    mentioned_status_ids = select(StatusMention.status_id).where(StatusMention.account_id == account.id)
    query = select(Status).where(
        Status.visibility == "direct",
        or_(Status.account_id == account.id, Status.id.in_(mentioned_status_ids)),
    )
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, account)


@router.get("/api/v1/timelines/link")
def timeline_link(url: str) -> list[Any]:
    """Empty list: the mock does not synthesize a trending-links timeline."""
    return []
