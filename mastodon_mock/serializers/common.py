"""Serialization helpers shared across entity serializers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def iso(dt: datetime | None) -> str | None:
    """Render a datetime as an ISO 8601 string with a ``Z``/offset, or ``None``."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def sid(value: int | None) -> str | None:
    """Stringify an id (Mastodon ``IdType``), preserving ``None``."""
    return None if value is None else str(value)


def account_acct(username: str, domain: str | None) -> str:
    """Compute ``acct`` (``username`` locally, ``username@domain`` remotely)."""
    return username if domain is None else f"{username}@{domain}"


def profile_url(config_domain: str, acct: str) -> str:
    """Compute a profile URL for an account."""
    return f"https://{config_domain}/@{acct}"


def status_url(config_domain: str, acct: str, status_id: int) -> str:
    """Compute a canonical status URL."""
    return f"https://{config_domain}/@{acct}/{status_id}"


def placeholder_avatar(config_domain: str, seed: str) -> str:
    """Return a deterministic per-account identicon avatar URL, keyed by ``seed`` (the acct)."""
    return f"https://{config_domain}/avatars/generated/{seed}.svg"


def placeholder_header(config_domain: str, seed: str) -> str:
    """Return a deterministic per-account identicon header URL, keyed by ``seed`` (the acct)."""
    return f"https://{config_domain}/headers/generated/{seed}.svg"


def drop_nulls(data: dict[str, Any]) -> dict[str, Any]:
    """Return ``data`` unchanged — kept for readability at call sites.

    Mastodon.py tolerates explicit nulls, so we do not strip them; this is a
    no-op hook in case stripping is ever desired.
    """
    return data
