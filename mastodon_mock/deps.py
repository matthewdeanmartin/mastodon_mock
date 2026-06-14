"""FastAPI dependencies: DB session, config, current token/account.

Auth is faked, not enforced (see spec/04-auth.md). The bearer token is looked up
in ``oauth_tokens``; a missing/unknown token yields ``None`` unless
``auth.permissive`` maps it to the first seeded account.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import Account, OAuthToken


def get_config(request: Request) -> MastodonMockConfig:
    """Return the active configuration from app state."""
    config: MastodonMockConfig = request.app.state.config
    return config


def get_db(request: Request) -> Iterator[Session]:
    """Yield a DB session bound to the app's engine."""
    factory: sessionmaker[Session] = request.app.state.session_factory
    session = factory()
    try:
        yield session
    finally:
        session.close()


DbSession = Annotated[Session, Depends(get_db)]
Config = Annotated[MastodonMockConfig, Depends(get_config)]


def get_current_token(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> OAuthToken | None:
    """Resolve the bearer token from the ``Authorization`` header, if any."""
    if authorization is None:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return db.scalar(select(OAuthToken).where(OAuthToken.access_token == token))


def get_current_account(
    db: DbSession,
    config: Config,
    token: Annotated[OAuthToken | None, Depends(get_current_token)] = None,
) -> Account | None:
    """Resolve the logged-in account, or ``None`` for unauthenticated requests."""
    if token is None or token.account_id is None:
        if config.auth.permissive:
            return db.scalars(select(Account).order_by(Account.id)).first()
        return None
    return db.get(Account, token.account_id)


CurrentToken = Annotated["OAuthToken | None", Depends(get_current_token)]
CurrentAccount = Annotated["Account | None", Depends(get_current_account)]


def require_account(
    account: CurrentAccount,
) -> Account:
    """Require an authenticated account, raising 401 otherwise."""
    if account is None:
        raise HTTPException(status_code=401, detail="This method requires an authenticated user")
    return account


RequiredAccount = Annotated[Account, Depends(require_account)]
