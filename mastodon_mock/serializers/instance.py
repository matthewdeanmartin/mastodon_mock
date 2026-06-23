"""Build instance metadata responses (v1, v2, nodeinfo)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, Status
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.versioning import api_version_for

# Roles that qualify an account as the instance's public contact. Highest
# privilege first so an owner is preferred over a plain admin/moderator.
_CONTACT_ROLE_PRIORITY = ("owner", "admin", "moderator")

# The advertised status length limit. The write path enforces the *same*
# constant (see routers/statuses.py) so the mock can't claim 500 in instance
# metadata while silently accepting longer posts.
MAX_STATUS_CHARACTERS = 500
MAX_MEDIA_ATTACHMENTS = 4

_STATUS_CONFIG = {
    "max_characters": MAX_STATUS_CHARACTERS,
    "max_media_attachments": MAX_MEDIA_ATTACHMENTS,
    "characters_reserved_per_url": 23,
}
_MEDIA_CONFIG = {
    "supported_mime_types": ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4"],
    "image_size_limit": 10485760,
    "image_matrix_limit": 16777216,
    "video_size_limit": 41943040,
    "video_frame_rate_limit": 60,
    "video_matrix_limit": 2304000,
}
_POLL_CONFIG = {
    "max_options": 4,
    "max_characters_per_option": 50,
    "min_expiration": 300,
    "max_expiration": 2629746,
}


def _contact_account(session: Session, config: MastodonMockConfig) -> dict[str, Any] | None:
    """Serialize the instance's public contact account, or ``None`` if no accounts exist.

    Prefers the highest-privilege staff account (owner > admin > moderator); failing
    that, falls back to the oldest account so a populated instance always advertises
    *someone*, matching real Mastodon (which always has a contact account set).
    """
    for role in _CONTACT_ROLE_PRIORITY:
        account = session.scalars(select(Account).where(Account.role == role).order_by(Account.id).limit(1)).first()
        if account is not None:
            return serialize_account(session, account, config)

    account = session.scalars(select(Account).order_by(Account.id).limit(1)).first()
    if account is not None:
        return serialize_account(session, account, config)
    return None


def _counts(session: Session) -> tuple[int, int]:
    """Return (user_count, status_count) computed live from the DB."""
    user_count = session.scalar(select(func.count()).select_from(Account)) or 0
    status_count = session.scalar(select(func.count()).select_from(Status)) or 0
    return user_count, status_count


def serialize_instance_v1(session: Session, config: MastodonMockConfig) -> dict[str, Any]:
    """Build the ``/api/v1/instance`` response."""
    user_count, status_count = _counts(session)
    return {
        "uri": config.domain,
        "title": config.title,
        "short_description": config.description,
        "description": config.description,
        "email": config.email,
        "version": config.mocked_version,
        "urls": {"streaming_api": f"wss://{config.domain}" if config.streaming.enabled else None},
        "stats": {"user_count": user_count, "status_count": status_count, "domain_count": 1},
        "thumbnail": None,
        "languages": ["en"],
        "registrations": config.registrations_enabled,
        "approval_required": config.registration_approval_required,
        "invites_enabled": False,
        "configuration": {
            "statuses": _STATUS_CONFIG,
            "media_attachments": _MEDIA_CONFIG,
            "polls": _POLL_CONFIG,
        },
        "contact_account": _contact_account(session, config),
        "rules": _rules(config),
    }


def serialize_instance_v2(session: Session, config: MastodonMockConfig) -> dict[str, Any]:
    """Build the ``/api/v2/instance`` response (includes ``api_versions``)."""
    user_count, _ = _counts(session)
    return {
        "domain": config.domain,
        "title": config.title,
        "version": config.mocked_version,
        "source_url": "https://github.com/matthewdeanmartin/mastodon_mock",
        "description": config.description,
        "usage": {"users": {"active_month": user_count}},
        "thumbnail": {"url": None},
        "languages": ["en"],
        "configuration": {
            "urls": {"streaming": f"wss://{config.domain}" if config.streaming.enabled else None},
            "statuses": _STATUS_CONFIG,
            "media_attachments": _MEDIA_CONFIG,
            "polls": _POLL_CONFIG,
            "translation": {"enabled": config.translation_enabled},
        },
        "registrations": {
            "enabled": config.registrations_enabled,
            "approval_required": config.registration_approval_required,
            "message": None,
        },
        "contact": {"email": config.email, "account": _contact_account(session, config)},
        "rules": _rules(config),
        "icon": [],
        "api_versions": {"mastodon": api_version_for(config.mocked_version)},
    }


def serialize_nodeinfo(session: Session, config: MastodonMockConfig) -> dict[str, Any]:
    """Build the nodeinfo 2.0 document."""
    user_count, status_count = _counts(session)
    return {
        "version": "2.0",
        "software": {"name": "mastodon", "version": config.mocked_version},
        "protocols": ["activitypub"],
        "services": {"outbound": [], "inbound": []},
        "usage": {"users": {"total": user_count}, "localPosts": status_count},
        "openRegistrations": True,
        "metadata": {},
    }


def _rules(config: MastodonMockConfig) -> list[dict[str, Any]]:
    """Serialize configured instance rules."""
    return [{"id": str(i + 1), "text": text, "hint": ""} for i, text in enumerate(config.rules)]
