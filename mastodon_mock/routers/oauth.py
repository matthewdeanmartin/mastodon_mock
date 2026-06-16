"""Apps & auth endpoints. See spec/04-auth.md.

Security is faked: tokens are random strings mapped 1:1 to accounts. The
``client_credentials`` grant always succeeds; ``password``/``authorization_code``
are rejected (matching current Mastodon + the headless mock constraints).
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException, Request

from mastodon_mock.db.models import Account, OAuthApp, OAuthToken, utcnow
from mastodon_mock.deps import Config, CurrentToken, DbSession, RequiredAccount
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import account_acct, sid

router = APIRouter()

_DEFAULT_SCOPES = ["read", "write", "follow", "push"]


def _token() -> str:
    """Generate a random opaque token."""
    return secrets.token_urlsafe(32)


@router.post("/api/v1/apps")
def create_app(
    db: DbSession,
    client_name: Annotated[str, Form()],
    redirect_uris: Annotated[str, Form()] = "urn:ietf:wg:oauth:2.0:oob",
    scopes: Annotated[str, Form()] = "read",
    website: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Register an OAuth application."""
    app = OAuthApp(
        client_id=_token(),
        client_secret=_token(),
        name=client_name,
        website=website,
        redirect_uris=redirect_uris.split("\n"),
        scopes=scopes.split(" "),
    )
    db.add(app)
    db.commit()
    return {
        "id": sid(app.id),
        "name": app.name,
        "website": app.website,
        "redirect_uri": app.redirect_uris[0] if app.redirect_uris else "urn:ietf:wg:oauth:2.0:oob",
        "redirect_uris": app.redirect_uris,
        "client_id": app.client_id,
        "client_secret": app.client_secret,
        "vapid_key": "mock-vapid-key",
        "scopes": app.scopes,
    }


@router.post("/oauth/token")
async def oauth_token(request: Request, db: DbSession) -> dict[str, Any]:
    """Issue tokens. Only ``client_credentials`` and ``refresh_token`` succeed."""
    form = await request.form()
    grant_type = form.get("grant_type")

    if grant_type == "client_credentials":
        app = _resolve_app(db, form.get("client_id"))
        token = OAuthToken(
            access_token=_token(),
            app_id=app.id if app else None,
            account_id=None,
            scopes=str(form.get("scope", "read")).split(" "),
            created_at=utcnow(),
        )
        db.add(token)
        db.commit()
        return _token_response(token)

    if grant_type == "refresh_token":
        existing = db.query(OAuthToken).filter(OAuthToken.refresh_token == form.get("refresh_token")).first()
        if existing is None:
            raise HTTPException(status_code=400, detail="invalid_grant")
        existing.access_token = _token()
        db.commit()
        return _token_response(existing)

    raise HTTPException(status_code=400, detail="unsupported_grant_type")


@router.post("/oauth/revoke")
async def oauth_revoke(request: Request, db: DbSession) -> dict[str, Any]:
    """Revoke (delete) a token."""
    form = await request.form()
    token_value = form.get("token")
    if token_value:
        existing = db.query(OAuthToken).filter(OAuthToken.access_token == token_value).first()
        if existing is not None:
            db.delete(existing)
            db.commit()
    return {}


@router.get("/.well-known/oauth-authorization-server")
def oauth_server_info(request: Request) -> dict[str, Any]:
    """Advertise the OAuth server config (no password grant; matches 4.4+)."""
    base = f"{request.url.scheme}://{request.url.netloc}"
    return {
        "issuer": f"{base}/",
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "userinfo_endpoint": f"{base}/oauth/userinfo",
        "scopes_supported": _DEFAULT_SCOPES,
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "client_credentials"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "code_challenge_methods_supported": ["S256"],
    }


@router.get("/oauth/userinfo")
def oauth_userinfo(account: RequiredAccount, config: Config) -> dict[str, Any]:
    """Minimal OIDC-ish claims derived from the authed account."""
    acct = account_acct(account.username, account.domain)
    return {
        "sub": sid(account.id),
        "preferred_username": account.username,
        "name": account.display_name,
        "profile": f"https://{config.domain}/@{acct}",
    }


@router.get("/api/v1/apps/verify_credentials")
def app_verify_credentials(db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Return info about the app for the bearer token."""
    if token is None or token.app_id is None:
        raise HTTPException(status_code=401, detail="The access token is invalid")
    app = db.get(OAuthApp, token.app_id)
    if app is None:
        raise HTTPException(status_code=401, detail="The access token is invalid")
    return {
        "name": app.name,
        "website": app.website,
        "scopes": app.scopes,
        "vapid_key": "mock-vapid-key",
    }


@router.post("/api/v1/accounts", status_code=200)
async def create_account(request: Request, db: DbSession, token: CurrentToken) -> dict[str, Any]:
    """Self-service signup: create an account + user token."""
    form = await request.form()
    username = form.get("username")
    email = form.get("email")
    password = form.get("password")
    agreement = str(form.get("agreement", "")).lower() in ("true", "1", "on")

    if not username or not email or not password:
        raise HTTPException(status_code=422, detail="Validation failed")
    if not agreement:
        raise HTTPException(status_code=422, detail="agreement must be accepted")

    existing = db.query(Account).filter(Account.username == username, Account.domain.is_(None)).first()
    if existing is not None:
        raise HTTPException(
            status_code=422, detail={"error": "Validation failed", "details": {"username": [{"error": "ERR_TAKEN"}]}}
        )

    account = Account(username=username, display_name=username, created_at=utcnow(), fields=[])
    db.add(account)
    db.flush()
    new_token = OAuthToken(
        access_token=_token(),
        app_id=token.app_id if token else None,
        account_id=account.id,
        scopes=list(_DEFAULT_SCOPES),
        created_at=utcnow(),
    )
    db.add(new_token)
    db.commit()
    return _token_response(new_token)


@router.post("/api/v1/emails/confirmations", status_code=200)
def email_resend_confirmation() -> dict[str, Any]:
    """Stub: accept and do nothing."""
    return {}


@router.post("/api/v1/_mock/login")
async def mock_login(request: Request, db: DbSession) -> dict[str, Any]:
    """Mock-only shortcut: issue a user token for a username."""
    body = await request.json()
    username = body.get("username")
    account = db.query(Account).filter(Account.username == username, Account.domain.is_(None)).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Unknown account")
    token = OAuthToken(
        access_token=_token(),
        account_id=account.id,
        scopes=list(_DEFAULT_SCOPES),
        created_at=utcnow(),
    )
    db.add(token)
    db.commit()
    return _token_response(token)


@router.post("/api/v1/_mock/dev_user", status_code=200)
async def mock_create_dev_user(request: Request, db: DbSession) -> dict[str, Any]:
    """Mock-only: create a fresh local account (+ token) for the dev login UI.

    Body (all optional): ``{"username": str, "display_name": str, "admin": bool}``.
    When ``username`` is omitted a unique one is generated. ``admin`` sets the account
    ``role`` to ``admin`` (the mock does not enforce roles, but the admin panel uses it
    to decide what to show).
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    admin = bool(body.get("admin"))
    prefix = "admin" if admin else "user"
    username = (body.get("username") or "").strip() or f"{prefix}_{secrets.token_hex(3)}"

    existing = db.query(Account).filter(Account.username == username, Account.domain.is_(None)).first()
    if existing is not None:
        raise HTTPException(status_code=422, detail=f"Username {username!r} already taken")

    account = Account(
        username=username,
        display_name=(body.get("display_name") or "").strip() or username,
        created_at=utcnow(),
        fields=[],
        email=f"{username}@local",
        role="admin" if admin else "user",
    )
    db.add(account)
    db.flush()
    token = OAuthToken(
        access_token=_token(),
        account_id=account.id,
        scopes=list(_DEFAULT_SCOPES),
        created_at=utcnow(),
    )
    db.add(token)
    db.commit()
    return {
        "id": sid(account.id),
        "username": account.username,
        "display_name": account.display_name,
        "role": account.role,
        "access_token": token.access_token,
    }


@router.get("/api/v1/_mock/dev_users")
def mock_list_dev_users(db: DbSession) -> list[dict[str, Any]]:
    """Mock-only: list local accounts that have a usable token, for the dev login UI.

    Returns the most-recent token per account so a tester can click to autofill it.
    """
    rows = (
        db.query(Account, OAuthToken)
        .join(OAuthToken, OAuthToken.account_id == Account.id)
        .filter(Account.domain.is_(None))
        .order_by(OAuthToken.created_at.desc())
        .all()
    )
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for account, token in rows:
        if account.id in seen:
            continue
        seen.add(account.id)
        out.append(
            {
                "id": sid(account.id),
                "username": account.username,
                "display_name": account.display_name,
                "role": account.role,
                "access_token": token.access_token,
            }
        )
    return out


@router.post("/api/v1/_mock/reset", status_code=200)
def mock_reset(request: Request) -> dict[str, Any]:
    """Mock-only: drop+recreate all tables and re-apply seed data."""
    from mastodon_mock.db.base import Base
    from mastodon_mock.db.seed import apply_seed_data

    engine = request.app.state.engine
    config = request.app.state.config
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    apply_seed_data(engine, config.seed)
    return {"ok": True}


def _resolve_app(db: DbSession, client_id: Any) -> OAuthApp | None:
    """Look up an app by client_id, if provided."""
    if not client_id:
        return None
    return db.query(OAuthApp).filter(OAuthApp.client_id == client_id).first()


def _token_response(token: OAuthToken) -> dict[str, Any]:
    """Shape an oauth token response."""
    return {
        "access_token": token.access_token,
        # "Bearer" is the OAuth token_type label, not a secret
        "token_type": "Bearer",  # nosec B105
        "scope": " ".join(token.scopes),
        "created_at": int(token.created_at.timestamp()),
    }


def serialize_authed_account(db: DbSession, account: Account, config: Config) -> dict[str, Any]:
    """Convenience used by tests/other routers (kept here for cohesion)."""
    return serialize_account(db, account, config, with_source=True)
