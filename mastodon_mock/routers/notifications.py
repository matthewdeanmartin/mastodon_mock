"""Notifications endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import func, select

from mastodon_mock.db.models import Account, Notification
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, array_query, set_link_header
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.grouped_notifications import (
    group_key_for,
    serialize_grouped_notifications,
)
from mastodon_mock.serializers.notifications import serialize_notification

router = APIRouter()


def _filtered_query(
    account_id: int,
    types: list[str] | None,
    exclude_types: list[str] | None,
    from_account_id: str | None,
) -> Any:
    """Build the base notifications query with the standard type/account filters."""
    query = select(Notification).where(Notification.account_id == account_id)
    if types:
        query = query.where(Notification.type.in_(types))
    if exclude_types:
        query = query.where(Notification.type.not_in(exclude_types))
    if from_account_id and from_account_id.isdigit():
        query = query.where(Notification.from_account_id == int(from_account_id))
    return query


@router.get("/api/v1/notifications")
def notifications(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
    account_id: str | None = None,
) -> list[dict[str, Any]]:
    """List notifications for the authed user, with type/account filters."""
    query = _filtered_query(
        account.id,
        array_query(request, "types"),
        array_query(request, "exclude_types"),
        account_id,
    )
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


@router.get("/api/v2/notifications")
def grouped_notifications(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
    account_id: str | None = None,
) -> dict[str, Any]:
    """Grouped notifications container (Mastodon 4.3+)."""
    query = _filtered_query(
        account.id,
        array_query(request, "types"),
        array_query(request, "exclude_types"),
        account_id,
    )
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
    return serialize_grouped_notifications(db, list(page.items), config, account)


@router.get("/api/v2/notifications/unread_count")
def grouped_unread_count(
    request: Request,
    db: DbSession,
    account: RequiredAccount,
    account_id: str | None = None,
) -> dict[str, int]:
    """Count of unread grouped notifications (counts distinct groups, not rows)."""
    query = _filtered_query(
        account.id,
        array_query(request, "types"),
        array_query(request, "exclude_types"),
        account_id,
    ).where(Notification.read.is_(False))
    notifs = db.scalars(query).all()
    groups = {group_key_for(n) for n in notifs}
    return {"count": len(groups)}


# NOTE: the static ``/policy`` routes must be declared *before* the
# ``/{notification_id}``/``/{group_key}`` catch-alls below (in either version), or
# ``GET /api/v1|v2/notifications/policy`` would match the id/group handler with
# ``notification_id="policy"``. Real Mastodon serves this endpoint at both v1 and v2
# (confirmed against mastodon.social — both return 401, not 404, when unauthenticated).
@router.get("/api/v1/notifications/policy")
@router.get("/api/v2/notifications/policy")
def notifications_policy() -> dict[str, Any]:
    """An "accept everything" notification policy (shape per mastodon.social)."""
    return {
        "for_not_following": "accept",
        "for_not_followers": "accept",
        "for_new_accounts": "accept",
        "for_private_mentions": "accept",
        "for_limited_accounts": "accept",
        "for_bots": "accept",
        "summary": {"pending_requests_count": 0, "pending_notifications_count": 0},
    }


@router.patch("/api/v1/notifications/policy")
@router.patch("/api/v2/notifications/policy")
async def update_notifications_policy(request: Request) -> dict[str, Any]:
    """Stub: accept and ignore policy updates."""
    return notifications_policy()


@router.get("/api/v2/notifications/{group_key}")
def grouped_notification(
    group_key: str,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Fetch a single grouped notification by its group key."""
    notifs = _group_members(db, account.id, group_key)
    if not notifs:
        raise HTTPException(status_code=404, detail="Record not found")
    return serialize_grouped_notifications(db, notifs, config, account)


@router.post("/api/v2/notifications/{group_key}/dismiss", status_code=200)
def dismiss_grouped_notification(
    group_key: str,
    db: DbSession,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Dismiss every notification in a group."""
    notifs = _group_members(db, account.id, group_key)
    for n in notifs:
        db.delete(n)
    db.commit()
    return {}


@router.get("/api/v2/notifications/{group_key}/accounts")
def grouped_notification_accounts(
    group_key: str,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    viewer: CurrentAccount,
) -> list[dict[str, Any]]:
    """Accounts associated with a grouped notification (newest actor first)."""
    notifs = _group_members(db, account.id, group_key)
    seen: dict[int, None] = {}
    for n in notifs:
        seen.setdefault(n.from_account_id, None)
    out: list[dict[str, Any]] = []
    for aid in seen:
        acc = db.get(Account, aid)
        if acc is not None:
            out.append(serialize_account(db, acc, config))
    return out


def _group_members(db: DbSession, account_id: int, group_key: str) -> list[Notification]:
    """All of an account's notifications whose group key equals ``group_key`` (newest first)."""
    rows = db.scalars(
        select(Notification).where(Notification.account_id == account_id).order_by(Notification.id.desc())
    ).all()
    return [n for n in rows if group_key_for(n) == group_key]


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


@router.get("/api/v1/notifications/requests")
def notification_requests(account: RequiredAccount) -> list[Any]:
    """Empty list: the mock's policy accepts everything, so nothing is filtered.

    See ``notifications_policy`` — with an "accept everything" policy there are no
    pending requests from filtered senders.
    """
    return []


@router.get("/api/v1/notifications/requests/merged")
def notification_requests_merged(account: RequiredAccount) -> dict[str, bool]:
    """Whether accepted requests have merged — always True (no async jobs here)."""
    return {"merged": True}


@router.post("/api/v1/notifications/requests/accept", status_code=200)
def accept_notification_requests(account: RequiredAccount) -> dict[str, Any]:
    """Accept multiple notification requests (no-op: nothing is filtered)."""
    return {}


@router.post("/api/v1/notifications/requests/dismiss", status_code=200)
def dismiss_notification_requests(account: RequiredAccount) -> dict[str, Any]:
    """Dismiss multiple notification requests (no-op: nothing is filtered)."""
    return {}


@router.get("/api/v1/notifications/requests/{request_id}")
def notification_request(request_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single notification request — 404, since none ever exist."""
    raise HTTPException(status_code=404, detail="Record not found")


@router.post("/api/v1/notifications/requests/{request_id}/accept", status_code=200)
def accept_notification_request(request_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Accept a single notification request (no-op)."""
    return {}


@router.post("/api/v1/notifications/requests/{request_id}/dismiss", status_code=200)
def dismiss_notification_request(request_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Dismiss a single notification request (no-op)."""
    return {}


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
