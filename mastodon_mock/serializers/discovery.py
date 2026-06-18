"""Serializers for discovery-ish surfaces: tags, trends, suggestions, activity.

These back the instance/trends/suggestions/featured-tags endpoints. Shapes were
captured from a live ``mastodon.social`` (see tests/integration). Where the mock
has real local data (hashtags, accounts) we derive from it; otherwise we emit a
correctly-shaped, deterministic value rather than a bare empty list.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from mastodon_mock.config import MastodonMockConfig


def _tag_history(uses_today: int = 0) -> list[dict[str, str]]:
    """A 7-day usage history block, newest day first (Mastodon ``Tag.history``).

    Counts are strings, matching the real API. Only the current day is populated
    with ``uses_today`` (and one account); prior days are zeroed.
    """
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    history: list[dict[str, str]] = []
    for offset in range(7):
        day = today - timedelta(days=offset)
        uses = uses_today if offset == 0 else 0
        accounts = 1 if (offset == 0 and uses_today) else 0
        history.append(
            {
                "day": str(int(day.timestamp())),
                "uses": str(uses),
                "accounts": str(accounts),
            }
        )
    return history


def serialize_tag(
    name: str,
    config: MastodonMockConfig,
    *,
    tag_id: str | None = None,
    following: bool = False,
    featuring: bool = False,
    uses_today: int = 0,
) -> dict[str, Any]:
    """Serialize a hashtag into the Mastodon ``Tag`` shape."""
    if tag_id is None:
        # Deterministic synthetic id derived from the name.
        tag_id = str(int(hashlib.sha256(name.encode("utf-8")).hexdigest()[:8], 16))
    return {
        "name": name,
        "url": f"https://{config.domain}/tags/{name}",
        "history": _tag_history(uses_today),
        "following": following,
        "id": tag_id,
        "trendable": None,
        "usable": None,
        "requires_review": None,
        "featuring": featuring,
    }


def serialize_featured_tag(
    name: str,
    config: MastodonMockConfig,
    acct: str,
    *,
    tag_id: str | None = None,
    statuses_count: int = 0,
    last_status_at: str | None = None,
) -> dict[str, Any]:
    """Serialize a ``FeaturedTag`` (account-level featured hashtag)."""
    if tag_id is None:
        tag_id = str(int(hashlib.sha256(f"{acct}:{name}".encode()).hexdigest()[:8], 16))
    return {
        "id": tag_id,
        "name": name,
        "statuses_count": str(statuses_count),
        "last_status_at": last_status_at,
        "url": f"https://{config.domain}/@{acct}/tagged/{name}",
    }


def serialize_suggestion(account_data: dict[str, Any]) -> dict[str, Any]:
    """Serialize a follow ``Suggestion`` (v2 shape) around a serialized account."""
    return {
        "source": "staff",
        "sources": ["featured"],
        "account": account_data,
    }


def serialize_activity_week(week_start: datetime, statuses: int, logins: int, registrations: int) -> dict[str, str]:
    """Serialize one ``/instance/activity`` week entry (all values are strings)."""
    return {
        "week": str(int(week_start.timestamp())),
        "statuses": str(statuses),
        "logins": str(logins),
        "registrations": str(registrations),
    }


def serialize_instance_domain_block(domain: str, severity: str, comment: str | None) -> dict[str, Any]:
    """Serialize an instance-level (public) ``DomainBlock`` entry."""
    digest = hashlib.sha256(domain.encode("utf-8")).hexdigest()
    return {
        "domain": domain,
        "digest": digest,
        "severity": severity,
        "comment": comment or "",
    }
