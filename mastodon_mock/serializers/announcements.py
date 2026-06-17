"""Serializers for instance announcements and terms of service."""

from __future__ import annotations

from collections import Counter
from typing import Any

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Announcement
from mastodon_mock.serializers.common import iso, sid


def _render_content(content: str) -> str:
    """Wrap a bare announcement body in a paragraph if it isn't already markup."""
    stripped = content.strip()
    if stripped.startswith("<"):
        return content
    return f"<p>{content}</p>"


def serialize_announcement(announcement: Announcement, viewer: Account | None) -> dict[str, Any]:
    """Serialize an ``Announcement`` with viewer-relative ``read`` + reactions.

    ``read`` is true when the viewer has dismissed it; reaction ``count`` is the
    number of accounts that reacted with each emoji and ``me`` flags the viewer's
    own reactions.
    """
    viewer_id = viewer.id if viewer is not None else None
    read = any(d.account_id == viewer_id for d in announcement.dismissals) if viewer_id is not None else False

    counts: Counter[str] = Counter(r.name for r in announcement.reactions)
    mine = {r.name for r in announcement.reactions if r.account_id == viewer_id} if viewer_id is not None else set()
    reactions = [
        {
            "name": name,
            "count": count,
            "me": name in mine,
            "url": None,
            "static_url": None,
        }
        for name, count in sorted(counts.items())
    ]

    return {
        "id": sid(announcement.id),
        "content": _render_content(announcement.content),
        "published": announcement.published,
        "starts_at": iso(announcement.starts_at),
        "ends_at": iso(announcement.ends_at),
        "all_day": announcement.all_day,
        "published_at": iso(announcement.published_at),
        "updated_at": iso(announcement.updated_at),
        "read": read,
        "mentions": [],
        "tags": [],
        "emojis": [],
        "reactions": reactions,
        "statuses": [],
    }


def serialize_terms_of_service(config: MastodonMockConfig) -> dict[str, Any]:
    """Serialize the instance terms of service (``TermsOfService``)."""
    return {
        "effective_date": None,
        "effective": True,
        "content": config.terms_of_service,
        "succeeded_by": None,
    }
