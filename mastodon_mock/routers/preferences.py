"""Preferences and markers endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from sqlalchemy import select

from mastodon_mock.db.models import Marker, utcnow
from mastodon_mock.deps import DbSession, RequiredAccount
from mastodon_mock.routers.helpers import array_query
from mastodon_mock.serializers.misc import serialize_marker, serialize_preferences

router = APIRouter()


@router.get("/api/v1/preferences")
def preferences(account: RequiredAccount) -> dict[str, Any]:
    """Return the authed user's preferences."""
    return serialize_preferences(account)


@router.get("/api/v1/markers")
def get_markers(
    request: Request,
    db: DbSession,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Return read markers for the requested timelines."""
    timelines = array_query(request, "timeline") or ["home", "notifications"]
    out: dict[str, Any] = {}
    for tl in timelines:
        marker = db.scalar(select(Marker).where(Marker.account_id == account.id, Marker.timeline == tl))
        if marker is not None:
            out[tl] = serialize_marker(marker)
    return out


@router.post("/api/v1/markers")
async def set_markers(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Set read markers for home/notifications timelines."""
    params = await _read_params(request)
    out: dict[str, Any] = {}
    for tl in ("home", "notifications"):
        last_read = _extract_last_read(params, tl)
        if last_read is None:
            continue
        marker = db.scalar(select(Marker).where(Marker.account_id == account.id, Marker.timeline == tl))
        if marker is None:
            marker = Marker(account_id=account.id, timeline=tl, last_read_id=last_read, version=1, updated_at=utcnow())
            db.add(marker)
        else:
            marker.last_read_id = last_read
            marker.version += 1
            marker.updated_at = utcnow()
        db.flush()
        out[tl] = serialize_marker(marker)
    db.commit()
    return out


async def _read_params(request: Request) -> dict[str, Any]:
    """Read marker params from JSON or form body."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            return dict(await request.json())
        except Exception:
            return {}
    try:
        form = await request.form()
        return {k: form.get(k) for k in form}
    except Exception:
        return {}


def _extract_last_read(params: dict[str, Any], timeline: str) -> int | None:
    """Pull ``<timeline>[last_read_id]`` from nested or bracketed params."""
    value = None
    if timeline in params and isinstance(params[timeline], dict):
        value = params[timeline].get("last_read_id")
    elif f"{timeline}[last_read_id]" in params:
        value = params[f"{timeline}[last_read_id]"]
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None
