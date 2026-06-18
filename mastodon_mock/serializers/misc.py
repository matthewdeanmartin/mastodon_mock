"""Serializers for lists, markers, filters, scheduled statuses, preferences."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import (
    Account,
    Filter,
    Marker,
    ScheduledStatus,
    UserList,
)
from mastodon_mock.serializers.common import iso, sid


def serialize_list(user_list: UserList) -> dict[str, Any]:
    """Serialize a ``UserList``."""
    return {
        "id": sid(user_list.id),
        "title": user_list.title,
        "replies_policy": user_list.replies_policy,
        "exclusive": user_list.exclusive,
    }


def serialize_marker(marker: Marker) -> dict[str, Any]:
    """Serialize a single timeline marker."""
    return {
        "last_read_id": sid(marker.last_read_id),
        "version": marker.version,
        "updated_at": iso(marker.updated_at),
    }


def serialize_filter_v2(filt: Filter) -> dict[str, Any]:
    """Serialize a ``FilterV2``."""
    return {
        "id": sid(filt.id),
        "title": filt.title,
        "context": filt.context or [],
        "expires_at": iso(filt.expires_at),
        "filter_action": filt.filter_action,
        "keywords": [serialize_filter_keyword(k) for k in filt.keywords],
        "statuses": [serialize_filter_status(s) for s in filt.status_filters],
    }


def serialize_filter_keyword(keyword: Any) -> dict[str, Any]:
    """Serialize a ``FilterKeyword``."""
    return {
        "id": sid(keyword.id),
        "keyword": keyword.keyword,
        "whole_word": keyword.whole_word,
    }


def serialize_filter_status(filter_status: Any) -> dict[str, Any]:
    """Serialize a ``FilterStatus`` (a status attached to a filter)."""
    return {
        "id": sid(filter_status.id),
        "status_id": sid(filter_status.status_id),
    }


def serialize_filter_v1(filt: Filter) -> dict[str, Any]:
    """Serialize a v1 ``Filter`` (single-keyword shape derived from v2 row)."""
    first = filt.keywords[0] if filt.keywords else None
    return {
        "id": sid(filt.id),
        "phrase": first.keyword if first else filt.title,
        "context": filt.context or [],
        "expires_at": iso(filt.expires_at),
        "irreversible": filt.filter_action == "hide",
        "whole_word": first.whole_word if first else True,
    }


def serialize_scheduled_status(
    scheduled: ScheduledStatus,
) -> dict[str, Any]:
    """Serialize a ``ScheduledStatus``.

    Real Mastodon's documented ``ScheduledStatus.params`` shape uses the key
    ``text`` for the post body. The mock stores the client-submitted params
    verbatim (key ``status``, matching ``POST /api/v1/statuses``'s own field name),
    so it's renamed here on the way out — otherwise a client reading ``params.text``
    sees nothing and the scheduled/draft post appears to have an empty body.
    """
    params = dict(scheduled.params or {})
    if "status" in params:
        params["text"] = params.pop("status")
    return {
        "id": sid(scheduled.id),
        "scheduled_at": iso(scheduled.scheduled_at),
        "params": params,
        "media_attachments": [],
    }


def serialize_preferences(account: Account) -> dict[str, Any]:
    """Serialize account preferences."""
    return {
        "posting:default:visibility": account.default_privacy,
        "posting:default:sensitive": account.default_sensitive,
        "posting:default:language": account.default_language,
        "reading:expand:media": "default",
        "reading:expand:spoilers": False,
    }


def serialize_conversation(
    session: Session,
    conversation_id: str,
    accounts: list[Account],
    last_status: dict[str, Any] | None,
    unread: bool,
    config: MastodonMockConfig,
) -> dict[str, Any]:
    """Serialize a ``Conversation`` from a participant set + last status."""
    from mastodon_mock.serializers.accounts import serialize_account

    return {
        "id": conversation_id,
        "unread": unread,
        "accounts": [serialize_account(session, a, config) for a in accounts],
        "last_status": last_status,
    }
