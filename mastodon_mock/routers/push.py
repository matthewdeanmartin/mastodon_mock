"""Web Push subscription endpoints. One subscription per OAuth token."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from mastodon_mock.db.models import OAuthToken, PushSubscription
from mastodon_mock.deps import CurrentToken, DbSession

router = APIRouter(tags=["push"])

_ALERT_KEYS = (
    "follow",
    "favourite",
    "reblog",
    "mention",
    "poll",
    "follow_request",
    "status",
    "update",
    "admin.sign_up",
    "admin.report",
    "quote",
    "quoted_update",
)


def _truthy(value: Any) -> bool:
    return str(value).lower() in ("true", "1", "on")


async def _form(request: Request) -> dict[str, str]:
    try:
        return {k: str(v) for k, v in (await request.form()).items()}
    except Exception:
        return {}


def _alerts_from_form(form: dict[str, str]) -> dict[str, bool]:
    return {key: _truthy(form[f"data[alerts][{key}]"]) for key in _ALERT_KEYS if f"data[alerts][{key}]" in form}


def _require_token(token: OAuthToken | None) -> OAuthToken:
    if token is None:
        raise HTTPException(status_code=401, detail="This method requires an authenticated user")
    return token


def _serialize(sub: PushSubscription) -> dict[str, Any]:
    return {
        "id": str(sub.id),
        "endpoint": sub.endpoint,
        "alerts": sub.alerts,
        "server_key": sub.server_key,
        "policy": sub.policy,
    }


def _subscription_or_404(db: DbSession, token: OAuthToken) -> PushSubscription:
    sub = db.query(PushSubscription).filter(PushSubscription.token_id == token.id).first()
    if sub is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return sub


@router.get("/api/v1/push/subscription")
def get_push_subscription(db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Fetch the current push subscription for the authed token."""
    return _serialize(_subscription_or_404(db, _require_token(token)))


@router.post("/api/v1/push/subscription")
async def create_push_subscription(request: Request, db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Create (or replace) the push subscription for the authed token."""
    tok = _require_token(token)
    form = await _form(request)
    existing = db.query(PushSubscription).filter(PushSubscription.token_id == tok.id).first()
    if existing is not None:
        db.delete(existing)
        db.flush()
    sub = PushSubscription(
        token_id=tok.id,
        endpoint=form.get("subscription[endpoint]", ""),
        server_key="BA" + "0" * 86,
        alerts=_alerts_from_form(form),
        policy=form.get("policy", "all"),
    )
    db.add(sub)
    db.commit()
    return _serialize(sub)


@router.put("/api/v1/push/subscription")
async def update_push_subscription(request: Request, db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Update alert/policy settings on the existing push subscription."""
    sub = _subscription_or_404(db, _require_token(token))
    form = await _form(request)
    if "policy" in form:
        sub.policy = form["policy"]
    alerts = dict(sub.alerts or {})
    alerts.update(_alerts_from_form(form))
    sub.alerts = alerts
    db.commit()
    return _serialize(sub)


@router.delete("/api/v1/push/subscription", status_code=200)
def delete_push_subscription(db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Remove the push subscription for the authed token."""
    tok = _require_token(token)
    sub = db.query(PushSubscription).filter(PushSubscription.token_id == tok.id).first()
    if sub is not None:
        db.delete(sub)
        db.commit()
    return {}
