"""Serialize grouped notifications (``GET /api/v2/notifications``, Mastodon 4.3+).

Mastodon groups *groupable* notification types (``favourite``, ``follow``,
``reblog``) that share a target into a single ``NotificationGroup``; other types
(``mention``, ``poll``, …) are returned individually with a unique group key. The
container also carries the referenced ``accounts`` and ``statuses`` so a client
need not refetch them.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Notification, Status
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import iso, sid

# Types Mastodon will collapse into one group when they share a target.
GROUPABLE_TYPES = frozenset({"favourite", "follow", "reblog"})


def group_key_for(notification: Notification) -> str:
    """Deterministic, re-derivable group key for a notification.

    Groupable types collapse by ``(type, status/follow target)``; everything else
    gets a unique per-notification key. Treated as opaque by clients, but we keep it
    stable so the single-group / dismiss / accounts endpoints can re-derive it.
    """
    if notification.type in GROUPABLE_TYPES:
        target = notification.status_id if notification.status_id is not None else "self"
        return f"{notification.type}-{target}"
    return f"ungrouped-{notification.id}"


def _serialize_group(notifs: list[Notification]) -> dict[str, Any]:
    """Serialize one group (newest notification first within the group)."""
    ordered = sorted(notifs, key=lambda n: n.id, reverse=True)
    most_recent = ordered[0]
    # Distinct sample accounts, most-recent first, capped like Mastodon (~8).
    seen: dict[int, None] = {}
    for n in ordered:
        seen.setdefault(n.from_account_id, None)
    sample_account_ids = [str(aid) for aid in list(seen)[:8]]

    return {
        "group_key": group_key_for(most_recent),
        "notifications_count": len(ordered),
        "type": most_recent.type,
        "most_recent_notification_id": sid(most_recent.id),
        "page_min_id": sid(ordered[-1].id),
        "page_max_id": sid(most_recent.id),
        "latest_page_notification_at": iso(most_recent.created_at),
        "sample_account_ids": sample_account_ids,
        "status_id": sid(most_recent.status_id),
    }


def serialize_grouped_notifications(
    session: Session,
    notifications: list[Notification],
    config: MastodonMockConfig,
    viewer: Account | None,
) -> dict[str, Any]:
    """Group ``notifications`` (already page-filtered, newest-first) into a container."""
    from mastodon_mock.serializers.statuses import serialize_status

    groups: dict[str, list[Notification]] = {}
    order: list[str] = []
    for n in notifications:
        key = group_key_for(n)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(n)

    notification_groups = [_serialize_group(groups[key]) for key in order]

    # Collect referenced accounts + statuses (de-duplicated) for the container.
    account_ids: dict[int, None] = {}
    status_ids: dict[int, None] = {}
    for n in notifications:
        account_ids.setdefault(n.from_account_id, None)
        if n.status_id is not None:
            status_ids.setdefault(n.status_id, None)

    accounts = []
    for aid in account_ids:
        acc = session.get(Account, aid)
        if acc is not None:
            accounts.append(serialize_account(session, acc, config))

    statuses = []
    for stid in status_ids:
        st = session.get(Status, stid)
        if st is not None:
            statuses.append(serialize_status(session, st, config, viewer))

    return {
        "accounts": accounts,
        "statuses": statuses,
        "notification_groups": notification_groups,
    }
