"""Notifications endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from sqlalchemy import func, select

from mastodon_mock.db.models import Notification
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, set_link_header
from mastodon_mock.serializers.notifications import serialize_notification

router = APIRouter()


@router.get("/api/v1/notifications")
def notifications(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
    types: Annotated[list[str] | None, Query()] = None,
    exclude_types: Annotated[list[str] | None, Query()] = None,
    account_id: str | None = None,
) -> list[dict[str, Any]]:
    """List notifications for the authed user, with type/account filters."""
    query = select(Notification).where(Notification.account_id == account.id)
    if types:
        query = query.where(Notification.type.in_(types))
    if exclude_types:
        query = query.where(Notification.type.not_in(exclude_types))
    if account_id and account_id.isdigit():
        query = query.where(Notification.from_account_id == int(account_id))

    page = paginate(
        db,
        query,
        Notification.id,
        max_id=params.max_id,
        min_id=params.min_id,
        since_id=params.since_id,
        limit=params.limit,
    )
    set_link_header(request, response, page)
    return [serialize_notification(db, n, config, account) for n in page.items]


@router.get("/api/v1/notifications/unread_count")
def unread_count(db: DbSession, account: RequiredAccount) -> dict[str, int]:
    """Return the count of unread notifications."""
    count = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.account_id == account.id, Notification.read.is_(False))
        )
        or 0
    )
    return {"count": count}


@router.post("/api/v1/notifications/clear", status_code=200)
def clear_notifications(db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete all notifications for the authed user."""
    for n in db.scalars(select(Notification).where(Notification.account_id == account.id)).all():
        db.delete(n)
    db.commit()
    return {}


@router.get("/api/v2/notifications/policy")
def notifications_policy() -> dict[str, Any]:
    """Stub: an "accept everything" policy."""
    return {
        "for_not_following": "accept",
        "for_not_followers": "accept",
        "for_new_accounts": "accept",
        "for_private_mentions": "accept",
        "for_limited_accounts": "accept",
        "summary": {"pending_requests_count": 0, "pending_notifications_count": 0},
    }


@router.patch("/api/v2/notifications/policy")
async def update_notifications_policy(request: Request) -> dict[str, Any]:
    """Stub: accept and ignore policy updates."""
    return notifications_policy()


@router.get("/api/v1/notifications/requests")
def notification_requests() -> list[Any]:
    """Stub: empty notification requests."""
    return []


@router.get("/api/v1/notifications/{notification_id}")
def get_notification(notification_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single notification."""
    notif = _notif_or_404(db, notification_id, account.id)
    return serialize_notification(db, notif, config, account)


@router.post("/api/v1/notifications/{notification_id}/dismiss", status_code=200)
def dismiss_notification(notification_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Dismiss (delete) a single notification."""
    notif = _notif_or_404(db, notification_id, account.id)
    db.delete(notif)
    db.commit()
    return {}


def _notif_or_404(db: DbSession, notification_id: str, account_id: int) -> Notification:
    """Fetch a notification owned by the account or raise 404."""
    try:
        notif = db.get(Notification, int(notification_id))
    except (ValueError, TypeError):
        notif = None
    if notif is None or notif.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return notif
