"""Serialize ``MediaAttachment`` rows."""

from __future__ import annotations

from typing import Any

from mastodon_mock.db.models import MediaAttachment
from mastodon_mock.serializers.common import sid


def serialize_media(media: MediaAttachment) -> dict[str, Any]:
    """Serialize a media attachment to Mastodon ``MediaAttachment`` JSON."""
    return {
        "id": sid(media.id),
        "type": media.type,
        "url": media.url,
        "preview_url": media.preview_url or media.url,
        "remote_url": None,
        "text_url": None,
        "description": media.description,
        "blurhash": media.blurhash,
        "meta": media.meta or {},
    }
