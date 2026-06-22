"""Content filter endpoints (v1 + v2)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from mastodon_mock.db.models import Filter, FilterKeyword, FilterStatus
from mastodon_mock.deps import DbSession, RequiredAccount
from mastodon_mock.pagination import parse_db_id
from mastodon_mock.serializers.misc import (
    serialize_filter_keyword,
    serialize_filter_status,
    serialize_filter_v1,
    serialize_filter_v2,
)

router = APIRouter(tags=["filters"])


async def _params(request: Request) -> dict[str, Any]:
    """Read filter params from JSON or form body."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            return dict(await request.json())
        except Exception:
            return {}
    out: dict[str, Any] = {}
    try:
        form = await request.form()
    except Exception:
        return out
    for key in form:
        values = form.getlist(key)
        out[key] = values if len(values) > 1 else values[0]
    return out


def _parse_dt(value: Any) -> datetime | None:
    """Parse an ISO datetime string."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _expiry(params: dict[str, Any]) -> datetime | None:
    """Resolve Mastodon's ``expires_in`` seconds or an explicit timestamp."""
    explicit = params.get("expires_at") or params.get("expires_in_at")
    if explicit:
        return _parse_dt(explicit)
    expires_in = params.get("expires_in")
    if expires_in in (None, ""):
        return None
    try:
        return datetime.now(timezone.utc) + timedelta(seconds=int(str(expires_in)))
    except (TypeError, ValueError):
        return None


def _context(params: dict[str, Any]) -> list[str]:
    """Extract the context list from params.

    Mastodon.py sends list params JSON-encoded as ``context`` but form-encoded
    as ``context[]``; accept either spelling.
    """
    ctx = params.get("context")
    if ctx is None:
        ctx = params.get("context[]")
    if isinstance(ctx, list):
        return [str(c) for c in ctx]
    if ctx:
        return [str(ctx)]
    return []


# --- v2 ---


@router.get("/api/v2/filters")
def filters_v2(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List v2 filters."""
    rows = db.scalars(select(Filter).where(Filter.account_id == account.id)).all()
    return [serialize_filter_v2(f) for f in rows]


@router.post("/api/v2/filters")
async def create_filter_v2(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Create a v2 filter."""
    params = await _params(request)
    filt = Filter(
        account_id=account.id,
        title=str(params.get("title") or ""),
        context=_context(params),
        expires_at=_expiry(params),
        filter_action=str(params.get("filter_action") or "warn"),
    )
    db.add(filt)
    db.flush()
    _apply_keywords(db, filt, params)
    db.commit()
    return serialize_filter_v2(filt)


@router.get("/api/v2/filters/{filter_id}")
def get_filter_v2(filter_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a v2 filter."""
    return serialize_filter_v2(_filter_or_404(db, filter_id, account.id))


@router.put("/api/v2/filters/{filter_id}")
async def update_filter_v2(filter_id: str, request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Update a v2 filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    params = await _params(request)
    if "title" in params:
        filt.title = str(params["title"])
    if "context" in params or "context[]" in params:
        filt.context = _context(params)
    if "filter_action" in params:
        filt.filter_action = str(params["filter_action"])
    if {"expires_at", "expires_in_at", "expires_in"} & params.keys():
        filt.expires_at = _expiry(params)
    db.commit()
    return serialize_filter_v2(filt)


@router.delete("/api/v2/filters/{filter_id}", status_code=200)
def delete_filter_v2(filter_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a v2 filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    db.delete(filt)
    db.commit()
    return {}


@router.get("/api/v2/filters/{filter_id}/keywords")
def filter_keywords_v2(filter_id: str, db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List a filter's keywords."""
    filt = _filter_or_404(db, filter_id, account.id)
    return [serialize_filter_keyword(k) for k in filt.keywords]


@router.post("/api/v2/filters/{filter_id}/keywords")
async def add_filter_keyword_v2(
    filter_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Add a keyword to a filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    params = await _params(request)
    kw = FilterKeyword(
        filter_id=filt.id,
        keyword=str(params.get("keyword") or ""),
        whole_word=str(params.get("whole_word", "true")).lower() in ("true", "1", "on"),
    )
    db.add(kw)
    db.commit()
    return serialize_filter_keyword(kw)


@router.get("/api/v2/filters/keywords/{keyword_id}")
def filter_keyword_v2(keyword_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single filter keyword by its own id."""
    return serialize_filter_keyword(_filter_keyword_or_404(db, keyword_id, account.id))


@router.put("/api/v2/filters/keywords/{keyword_id}")
async def update_filter_keyword_v2(
    keyword_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Update a filter keyword's text/whole_word flag."""
    kw = _filter_keyword_or_404(db, keyword_id, account.id)
    params = await _params(request)
    if "keyword" in params:
        kw.keyword = str(params["keyword"])
    if "whole_word" in params:
        kw.whole_word = str(params["whole_word"]).lower() in ("true", "1", "on")
    db.commit()
    return serialize_filter_keyword(kw)


@router.delete("/api/v2/filters/keywords/{keyword_id}", status_code=200)
def delete_filter_keyword_v2(keyword_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a filter keyword."""
    pid = parse_db_id(keyword_id)
    kw = db.get(FilterKeyword, pid) if pid is not None else None
    if kw is not None:
        db.delete(kw)
        db.commit()
    return {}


@router.get("/api/v2/filters/{filter_id}/statuses")
def filter_statuses_v2(filter_id: str, db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List the statuses attached to a filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    return [serialize_filter_status(s) for s in filt.status_filters]


@router.post("/api/v2/filters/{filter_id}/statuses")
async def add_filter_status_v2(
    filter_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Attach a status to a filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    params = await _params(request)
    status_id = params.get("status_id")
    if not status_id:
        raise HTTPException(status_code=422, detail="Validation failed: Status can't be blank")
    status_id_int = parse_db_id(status_id)
    if status_id_int is None:
        raise HTTPException(status_code=422, detail="Validation failed: Status is invalid")
    fs = FilterStatus(filter_id=filt.id, status_id=status_id_int)
    db.add(fs)
    db.commit()
    return serialize_filter_status(fs)


@router.get("/api/v2/filters/statuses/{filter_status_id}")
def filter_status_v2(filter_status_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single filter-status row by its id."""
    return serialize_filter_status(_filter_status_or_404(db, filter_status_id, account.id))


@router.delete("/api/v2/filters/statuses/{filter_status_id}", status_code=200)
def delete_filter_status_v2(filter_status_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Detach a status from a filter."""
    fs = _filter_status_or_404(db, filter_status_id, account.id)
    db.delete(fs)
    db.commit()
    return {}


# --- v1 ---


@router.get("/api/v1/filters")
def filters_v1(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List v1 filters (single-keyword shape)."""
    rows = db.scalars(select(Filter).where(Filter.account_id == account.id)).all()
    return [serialize_filter_v1(f) for f in rows]


@router.post("/api/v1/filters")
async def create_filter_v1(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Create a v1 filter (one phrase → one keyword)."""
    params = await _params(request)
    phrase = str(params.get("phrase") or "")
    filt = Filter(
        account_id=account.id,
        title=phrase,
        context=_context(params),
        expires_at=_expiry(params),
        filter_action="hide" if str(params.get("irreversible", "")).lower() in ("true", "1", "on") else "warn",
    )
    db.add(filt)
    db.flush()
    db.add(
        FilterKeyword(
            filter_id=filt.id,
            keyword=phrase,
            whole_word=str(params.get("whole_word", "true")).lower() in ("true", "1", "on"),
        )
    )
    db.commit()
    return serialize_filter_v1(filt)


@router.get("/api/v1/filters/{filter_id}")
def get_filter_v1(filter_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a v1 filter."""
    return serialize_filter_v1(_filter_or_404(db, filter_id, account.id))


@router.put("/api/v1/filters/{filter_id}")
async def update_filter_v1(filter_id: str, request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Update a v1 filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    params = await _params(request)
    if "phrase" in params:
        filt.title = str(params["phrase"])
        if filt.keywords:
            filt.keywords[0].keyword = str(params["phrase"])
    if "context" in params or "context[]" in params:
        filt.context = _context(params)
    if "irreversible" in params:
        filt.filter_action = "hide" if str(params["irreversible"]).lower() in ("true", "1", "on") else "warn"
    if {"expires_at", "expires_in"} & params.keys():
        filt.expires_at = _expiry(params)
    db.commit()
    return serialize_filter_v1(filt)


@router.delete("/api/v1/filters/{filter_id}", status_code=200)
def delete_filter_v1(filter_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a v1 filter."""
    filt = _filter_or_404(db, filter_id, account.id)
    db.delete(filt)
    db.commit()
    return {}


# --- helpers ---


def _apply_keywords(db: DbSession, filt: Filter, params: dict[str, Any]) -> None:
    """Create keywords from ``keywords_attributes`` form/JSON shapes."""
    attrs = params.get("keywords_attributes")
    if isinstance(attrs, list):
        for entry in attrs:
            if isinstance(entry, dict) and entry.get("keyword"):
                db.add(
                    FilterKeyword(
                        filter_id=filt.id,
                        keyword=str(entry["keyword"]),
                        whole_word=bool(entry.get("whole_word", True)),
                    )
                )


def _filter_or_404(db: DbSession, filter_id: str, account_id: int) -> Filter:
    """Fetch a filter owned by the account or raise 404."""
    pid = parse_db_id(filter_id)
    filt = db.get(Filter, pid) if pid is not None else None
    if filt is None or filt.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return filt


def _filter_keyword_or_404(db: DbSession, keyword_id: str, account_id: int) -> FilterKeyword:
    """Fetch a filter keyword whose parent filter is owned by the account, or raise 404."""
    pid = parse_db_id(keyword_id)
    kw = db.get(FilterKeyword, pid) if pid is not None else None
    if kw is None:
        raise HTTPException(status_code=404, detail="Record not found")
    _filter_or_404(db, str(kw.filter_id), account_id)
    return kw


def _filter_status_or_404(db: DbSession, filter_status_id: str, account_id: int) -> FilterStatus:
    """Fetch a filter-status row whose parent filter the account owns, or 404."""
    pid = parse_db_id(filter_status_id)
    fs = db.get(FilterStatus, pid) if pid is not None else None
    if fs is None:
        raise HTTPException(status_code=404, detail="Record not found")
    parent = db.get(Filter, fs.filter_id)
    if parent is None or parent.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return fs
