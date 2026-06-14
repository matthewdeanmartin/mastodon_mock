"""Favourites and bookmarks listing endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from mastodon_mock.db.models import Bookmark, Favourite, Status
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, set_link_header
from mastodon_mock.serializers.statuses import serialize_status

router = APIRouter()


@router.get("/api/v1/favourites")
def favourites(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """List the authed user's favourited statuses (newest first)."""
    query = select(Status).join(Favourite, Favourite.status_id == Status.id).where(Favourite.account_id == account.id)
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return [serialize_status(db, s, config, account) for s in page.items]


@router.get("/api/v1/bookmarks")
def bookmarks(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """List the authed user's bookmarked statuses (newest first)."""
    query = select(Status).join(Bookmark, Bookmark.status_id == Status.id).where(Bookmark.account_id == account.id)
    page = paginate(
        db, query, Status.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return [serialize_status(db, s, config, account) for s in page.items]
