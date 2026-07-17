"""Mock-only user-settings endpoints (``/api/v1/_mock/settings`` and friends).

Real Mastodon keeps these web-UI settings pages (appearance, email notifications,
automated post deletion, import/export, invites, authorized apps) server-side with
no public API. The mock's settings UI needs real endpoints, so they live here under
the ``/api/v1/_mock`` namespace, which the OpenAPI drift comparison allow-lists
(see ``mastodon_mock.openapi_compare.DEFAULT_MOCK_ONLY_PREFIXES``).
"""

from __future__ import annotations

import copy
import csv
import io
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select

from mastodon_mock.db.models import Account, AccountSettings, Invite, OAuthApp, OAuthToken, Relationship, utcnow
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.routers.helpers import read_body
from mastodon_mock.serializers.common import account_acct, iso, sid
from mastodon_mock.services import get_or_create_relationship

router = APIRouter(tags=["mock settings"])

# Defaults for the per-account settings blob. PUT deep-merges into these, so the
# GET response always has every key populated.
DEFAULT_SETTINGS: dict[str, Any] = {
    "appearance": {
        "theme": "auto",  # auto | light | dark
        "reduce_motion": False,
        "disable_swiping": False,
        "expand_spoilers": False,
        "display_media": "default",  # default | show_all | hide_all
    },
    "email_notifications": {
        "follow": True,
        "follow_request": True,
        "reblog": False,
        "favourite": False,
        "mention": True,
        "report": True,
        "digest": True,
    },
    "post_deletion": {
        "enabled": False,
        "min_age_days": 30,
        "keep_pinned": True,
        "keep_favourited": False,
        "keep_media": False,
        "keep_polls": False,
        "min_favourites": 0,
        "min_reblogs": 0,
    },
}

_EXPORT_KINDS = ("following", "mutes", "blocks")


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``override`` into a copy of ``base``; scalar wins over dict."""
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _settings_row(db: DbSession, account_id: int) -> AccountSettings | None:
    """Return the settings row for an account, or ``None``."""
    return db.scalar(select(AccountSettings).where(AccountSettings.account_id == account_id))


@router.get("/api/v1/_mock/settings")
def get_settings(db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Return the authed user's settings blob, merged over defaults."""
    row = _settings_row(db, account.id)
    stored = row.data if row is not None else {}
    return _deep_merge(DEFAULT_SETTINGS, stored)


@router.put("/api/v1/_mock/settings")
async def put_settings(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Deep-merge the request body into the stored settings blob and return the result."""
    body = await read_body(request)
    row = _settings_row(db, account.id)
    if row is None:
        row = AccountSettings(account_id=account.id, data={})
        db.add(row)
    row.data = _deep_merge(row.data, body)
    row.updated_at = utcnow()
    db.commit()
    return _deep_merge(DEFAULT_SETTINGS, row.data)


def _serialize_invite(invite: Invite, domain: str) -> dict[str, Any]:
    """Serialize an invite row for the settings UI."""
    return {
        "id": sid(invite.id),
        "code": invite.code,
        "url": f"https://{domain}/invite/{invite.code}",
        "max_uses": invite.max_uses,
        "uses": invite.uses,
        "expires_at": iso(invite.expires_at),
        "created_at": iso(invite.created_at),
        "revoked": invite.revoked,
    }


@router.get("/api/v1/_mock/invites")
def list_invites(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List the authed user's invites, newest first."""
    domain = config.domain
    invites = db.scalars(select(Invite).where(Invite.account_id == account.id).order_by(Invite.created_at.desc())).all()
    return [_serialize_invite(i, domain) for i in invites]


@router.post("/api/v1/_mock/invites")
async def create_invite(request: Request, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Create an invite. Body (optional): ``{"max_uses": int|null, "expires_in": seconds|null}``."""
    body = await read_body(request)
    max_uses: int | None = None
    if body.get("max_uses") not in (None, ""):
        try:
            max_uses = int(body["max_uses"])
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="max_uses must be an integer") from exc
        if max_uses <= 0:
            raise HTTPException(status_code=422, detail="max_uses must be positive")
    expires_at = None
    if body.get("expires_in") not in (None, ""):
        try:
            expires_in = int(body["expires_in"])
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="expires_in must be an integer") from exc
        expires_at = datetime.fromtimestamp(utcnow().timestamp() + expires_in, tz=timezone.utc)
    invite = Invite(
        account_id=account.id,
        code=secrets.token_urlsafe(8),
        max_uses=max_uses,
        expires_at=expires_at,
        created_at=utcnow(),
    )
    db.add(invite)
    db.commit()
    return _serialize_invite(invite, config.domain)


@router.delete("/api/v1/_mock/invites/{invite_id}", status_code=200)
def revoke_invite(invite_id: int, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Revoke (deactivate) one of the authed user's invites."""
    invite = db.scalar(select(Invite).where(Invite.id == invite_id, Invite.account_id == account.id))
    if invite is None:
        raise HTTPException(status_code=404, detail="Record not found")
    invite.revoked = True
    db.commit()
    return _serialize_invite(invite, config.domain)


@router.get("/api/v1/_mock/apps")
def list_authorized_apps(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List OAuth apps that hold a token for the authed user (the "Development" page)."""
    rows = db.execute(
        select(OAuthApp, OAuthToken)
        .join(OAuthToken, OAuthToken.app_id == OAuthApp.id)
        .where(OAuthToken.account_id == account.id)
        .order_by(OAuthToken.created_at.desc())
    ).all()
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for app, token in rows:
        if app.id in seen:
            continue
        seen.add(app.id)
        out.append(
            {
                "id": sid(app.id),
                "name": app.name,
                "website": app.website,
                "scopes": token.scopes,
                "last_used_at": iso(token.created_at),
            }
        )
    return out


def _relationship_rows(db: DbSession, account_id: int, kind: str) -> list[tuple[Account, Relationship]]:
    """Return (target account, relationship) pairs for one export kind."""
    flag = {"following": Relationship.following, "mutes": Relationship.muting, "blocks": Relationship.blocking}[kind]
    return list(
        db.execute(
            select(Account, Relationship)
            .join(Relationship, Relationship.target_account_id == Account.id)
            .where(Relationship.source_account_id == account_id, flag.is_(True))
            .order_by(Account.username)
        ).all()
    )


@router.get("/api/v1/_mock/export/{kind}")
def export_csv(kind: str, db: DbSession, account: RequiredAccount) -> PlainTextResponse:
    """Export following/mutes/blocks as CSV, shaped like real Mastodon's settings export."""
    if kind not in _EXPORT_KINDS:
        raise HTTPException(status_code=404, detail="Record not found")
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    rows = _relationship_rows(db, account.id, kind)
    if kind == "following":
        writer.writerow(["Account address", "Show boosts", "Notify on new posts", "Languages"])
        for acc, rel in rows:
            langs = ", ".join(rel.languages) if rel.languages else ""
            writer.writerow([account_acct(acc.username, acc.domain), rel.showing_reblogs, rel.notifying, langs])
    elif kind == "mutes":
        writer.writerow(["Account address", "Hide notifications"])
        for acc, rel in rows:
            writer.writerow([account_acct(acc.username, acc.domain), rel.muting_notifications])
    else:
        for acc, _rel in rows:
            writer.writerow([account_acct(acc.username, acc.domain)])
    filename = f"{kind}.csv"
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _find_account_by_acct(db: DbSession, acct: str) -> Account | None:
    """Resolve ``user`` or ``user@domain`` to a known account."""
    acct = acct.strip().lstrip("@")
    if not acct:
        return None
    username, _, domain = acct.partition("@")
    return db.scalar(
        select(Account).where(
            Account.username == username,
            Account.domain == (domain or None),
        )
    )


@router.post("/api/v1/_mock/import")
async def import_csv(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Import a follows/mutes/blocks CSV. Body: ``{"type": kind, "csv": text}``.

    The first CSV column is the account address; a header row is skipped. Unknown
    accounts are reported back rather than failing the whole import.
    """
    body = await read_body(request)
    kind = body.get("type")
    if kind not in _EXPORT_KINDS:
        raise HTTPException(status_code=422, detail=f"type must be one of {', '.join(_EXPORT_KINDS)}")
    text = body.get("csv")
    if not isinstance(text, str) or not text.strip():
        raise HTTPException(status_code=422, detail="csv text is required")

    imported = 0
    skipped: list[str] = []
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0].strip():
            continue
        address = row[0].strip()
        if address.lower() == "account address":  # header row
            continue
        target = _find_account_by_acct(db, address)
        if target is None or target.id == account.id:
            skipped.append(address)
            continue
        rel = get_or_create_relationship(db, account.id, target.id)
        if kind == "following":
            rel.following = True
        elif kind == "mutes":
            rel.muting = True
        else:
            rel.blocking = True
        imported += 1
    db.commit()
    return {"type": kind, "imported": imported, "skipped": skipped}
