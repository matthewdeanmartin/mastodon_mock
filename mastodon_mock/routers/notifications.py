"""Notifications endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import func, select

from mastodon_mock.db.models import (
    Account,
    Notification,
    NotificationPolicy,
    NotificationPolicyOverride,
    NotificationRequest,
    Status,
)
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate, parse_db_id
from mastodon_mock.routers.helpers import PageQuery, array_query, read_body, set_link_header
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.grouped_notifications import (
    group_key_for,
    serialize_grouped_notifications,
)
from mastodon_mock.serializers.notifications import serialize_notification

router = APIRouter(tags=["notifications"])


def _filtered_query(
    account_id: int,
    types: list[str] | None,
    exclude_types: list[str] | None,
    from_account_id: str | None,
    include_filtered: bool = False,
) -> Any:
    """Build the base notifications query with the standard type/account filters."""
    query = select(Notification).where(Notification.account_id == account_id)
    if not include_filtered:
        query = query.where(Notification.request_id.is_(None))
    if types:
        query = query.where(Notification.type.in_(types))
    if exclude_types:
        query = query.where(Notification.type.not_in(exclude_types))
    if from_account_id:
        from_id = parse_db_id(from_account_id)
        if from_id is not None:
            query = query.where(Notification.from_account_id == from_id)
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
    include_filtered: bool = False,
) -> list[dict[str, Any]]:
    """List notifications for the authed user, with type/account filters."""
    query = _filtered_query(
        account.id,
        array_query(request, "types"),
        array_query(request, "exclude_types"),
        account_id,
        include_filtered,
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
    return [serialize_notification(db, n, config, account, filter_context="notifications") for n in page.items]


@router.get("/api/v2/notifications")
def grouped_notifications(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
    account_id: str | None = None,
    include_filtered: bool = False,
) -> dict[str, Any]:
    """Grouped notifications container (Mastodon 4.3+)."""
    query = _filtered_query(
        account.id,
        array_query(request, "types"),
        array_query(request, "exclude_types"),
        account_id,
        include_filtered,
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
def notifications_policy(db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """The authenticated account's persisted notification policy."""
    policy = _policy(db, account.id)
    pending_requests = (
        db.scalar(
            select(func.count()).select_from(NotificationRequest).where(NotificationRequest.account_id == account.id)
        )
        or 0
    )
    pending_notifications = (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.account_id == account.id,
                Notification.request_id.is_not(None),
            )
        )
        or 0
    )
    return {
        "for_not_following": policy.for_not_following,
        "for_not_followers": policy.for_not_followers,
        "for_new_accounts": policy.for_new_accounts,
        "for_private_mentions": policy.for_private_mentions,
        "for_limited_accounts": policy.for_limited_accounts,
        "for_bots": "accept",
        "summary": {
            "pending_requests_count": min(pending_requests, 100),
            "pending_notifications_count": pending_notifications,
        },
    }


@router.patch("/api/v1/notifications/policy")
@router.patch("/api/v2/notifications/policy")
async def update_notifications_policy(
    request: Request,
    db: DbSession,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Persist notification filtering policy fields."""
    policy = _policy(db, account.id)
    body = await read_body(request)
    valid = {"accept", "filter", "drop"}
    for field in (
        "for_not_following",
        "for_not_followers",
        "for_new_accounts",
        "for_private_mentions",
        "for_limited_accounts",
    ):
        if field in body:
            value = str(body[field])
            if value not in valid:
                raise HTTPException(status_code=422, detail=f"Invalid policy value for {field}")
            setattr(policy, field, value)
    db.commit()
    return notifications_policy(db, account)


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
            .where(
                Notification.account_id == account.id,
                Notification.read.is_(False),
                Notification.request_id.is_(None),
            )
        )
        or 0
    )
    return {"count": count}


@router.post("/api/v1/notifications/clear", status_code=200)
def clear_notifications(db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete all notifications for the authed user."""
    for n in db.scalars(select(Notification).where(Notification.account_id == account.id)).all():
        db.delete(n)
    for item in db.scalars(select(NotificationRequest).where(NotificationRequest.account_id == account.id)).all():
        db.delete(item)
    db.commit()
    return {}


@router.get("/api/v1/notifications/requests")
def notification_requests(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """List actors whose notifications were filtered by the account's policy."""
    page = paginate(
        db,
        select(NotificationRequest).where(NotificationRequest.account_id == account.id),
        NotificationRequest.id,
        max_id=params.max_id,
        min_id=params.min_id,
        since_id=params.since_id,
        limit=params.limit,
    )
    set_link_header(request, response, page)
    return [_serialize_request(db, item, config, account) for item in page.items]


@router.get("/api/v1/notifications/requests/merged")
def notification_requests_merged(account: RequiredAccount) -> dict[str, bool]:
    """Whether accepted requests have merged — always True (no async jobs here)."""
    return {"merged": True}


@router.post("/api/v1/notifications/requests/accept", status_code=200)
async def accept_notification_requests(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Accept multiple notification requests."""
    for request_id in await _request_ids(request):
        item = _request_or_404(db, request_id, account.id)
        _accept_request(db, item)
    db.commit()
    return {}


@router.post("/api/v1/notifications/requests/dismiss", status_code=200)
async def dismiss_notification_requests(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Dismiss multiple notification requests."""
    for request_id in await _request_ids(request):
        item = _request_or_404(db, request_id, account.id)
        _dismiss_request(db, item)
    db.commit()
    return {}


@router.get("/api/v1/notifications/requests/{request_id}")
def notification_request(
    request_id: str,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Fetch one filtered notification request."""
    return _serialize_request(db, _request_or_404(db, request_id, account.id), config, account)


@router.post("/api/v1/notifications/requests/{request_id}/accept", status_code=200)
def accept_notification_request(request_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Move filtered notifications into the main feed and allow the actor."""
    _accept_request(db, _request_or_404(db, request_id, account.id))
    db.commit()
    return {}


@router.post("/api/v1/notifications/requests/{request_id}/dismiss", status_code=200)
def dismiss_notification_request(request_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete filtered notifications from one actor."""
    _dismiss_request(db, _request_or_404(db, request_id, account.id))
    db.commit()
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
    pid = parse_db_id(notification_id)
    notif = db.get(Notification, pid) if pid is not None else None
    if notif is None or notif.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return notif


def _policy(db: DbSession, account_id: int) -> NotificationPolicy:
    policy = db.scalar(select(NotificationPolicy).where(NotificationPolicy.account_id == account_id))
    if policy is None:
        policy = NotificationPolicy(account_id=account_id)
        db.add(policy)
        db.flush()
    return policy


def _request_or_404(db: DbSession, request_id: str, account_id: int) -> NotificationRequest:
    pid = parse_db_id(request_id)
    item = db.get(NotificationRequest, pid) if pid is not None else None
    if item is None or item.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return item


def _serialize_request(
    db: DbSession,
    item: NotificationRequest,
    config: Config,
    viewer: Account,
) -> dict[str, Any]:
    actor = db.get(Account, item.from_account_id)
    notifications = db.scalars(
        select(Notification).where(Notification.request_id == item.id).order_by(Notification.id.desc())
    ).all()
    last_status = None
    for notification in notifications:
        if notification.status_id is not None:
            status = db.get(Status, notification.status_id)
            if status is not None:
                from mastodon_mock.serializers.statuses import serialize_status

                last_status = serialize_status(db, status, config, viewer, filter_context="notifications")
                break
    return {
        "id": str(item.id),
        "created_at": item.created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": item.updated_at.isoformat().replace("+00:00", "Z"),
        "notifications_count": str(len(notifications)),
        "account": serialize_account(db, actor, config) if actor is not None else None,
        "last_status": last_status,
    }


def _accept_request(db: DbSession, item: NotificationRequest) -> None:
    for notification in db.scalars(select(Notification).where(Notification.request_id == item.id)).all():
        notification.request_id = None
    exists = db.scalar(
        select(NotificationPolicyOverride).where(
            NotificationPolicyOverride.account_id == item.account_id,
            NotificationPolicyOverride.from_account_id == item.from_account_id,
        )
    )
    if exists is None:
        db.add(
            NotificationPolicyOverride(
                account_id=item.account_id,
                from_account_id=item.from_account_id,
            )
        )
    db.delete(item)


def _dismiss_request(db: DbSession, item: NotificationRequest) -> None:
    for notification in db.scalars(select(Notification).where(Notification.request_id == item.id)).all():
        db.delete(notification)
    db.delete(item)


async def _request_ids(request: Request) -> list[str]:
    body = await read_body(request)
    raw = body.get("id") or body.get("id[]") or []
    if not isinstance(raw, list):
        raw = [raw]
    return [str(value) for value in raw]
