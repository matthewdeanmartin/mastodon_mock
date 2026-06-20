"""Serialize ``Notification`` rows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Notification, Status
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import iso, sid


def serialize_notification(
    session: Session,
    notification: Notification,
    config: MastodonMockConfig,
    viewer: Account | None,
    *,
    filter_context: str | None = None,
) -> dict[str, Any]:
    """Serialize a notification, embedding actor account and (optional) status."""
    from mastodon_mock.serializers.statuses import serialize_status

    from_account = session.get(Account, notification.from_account_id)
    status_data = None
    if notification.status_id is not None:
        status = session.get(Status, notification.status_id)
        if status is not None:
            status_data = serialize_status(session, status, config, viewer, filter_context=filter_context)

    return {
        "id": sid(notification.id),
        "type": notification.type,
        "created_at": iso(notification.created_at),
        "account": serialize_account(session, from_account, config) if from_account else None,
        "status": status_data,
        "group_key": f"ungrouped-{notification.id}",
    }
