"""User list endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException, Request
from sqlalchemy import select

from mastodon_mock.db.models import Account, UserList, UserListAccount
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.misc import serialize_list

router = APIRouter()


@router.get("/api/v1/lists")
def get_lists(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List the authed user's lists."""
    rows = db.scalars(select(UserList).where(UserList.account_id == account.id)).all()
    return [serialize_list(ul) for ul in rows]


@router.post("/api/v1/lists")
def create_list(
    db: DbSession,
    account: RequiredAccount,
    title: Annotated[str, Form()],
    replies_policy: Annotated[str, Form()] = "list",
    exclusive: Annotated[bool, Form()] = False,
) -> dict[str, Any]:
    """Create a list."""
    ul = UserList(account_id=account.id, title=title, replies_policy=replies_policy, exclusive=exclusive)
    db.add(ul)
    db.commit()
    return serialize_list(ul)


@router.get("/api/v1/lists/{list_id}")
def get_list(list_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single list."""
    return serialize_list(_list_or_404(db, list_id, account.id))


@router.put("/api/v1/lists/{list_id}")
def update_list(
    list_id: str,
    db: DbSession,
    account: RequiredAccount,
    title: Annotated[str | None, Form()] = None,
    replies_policy: Annotated[str | None, Form()] = None,
    exclusive: Annotated[bool | None, Form()] = None,
) -> dict[str, Any]:
    """Update a list."""
    ul = _list_or_404(db, list_id, account.id)
    if title is not None:
        ul.title = title
    if replies_policy is not None:
        ul.replies_policy = replies_policy
    if exclusive is not None:
        ul.exclusive = exclusive
    db.commit()
    return serialize_list(ul)


@router.delete("/api/v1/lists/{list_id}", status_code=200)
def delete_list(list_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a list."""
    ul = _list_or_404(db, list_id, account.id)
    db.query(UserListAccount).filter(UserListAccount.list_id == ul.id).delete()
    db.delete(ul)
    db.commit()
    return {}


@router.get("/api/v1/lists/{list_id}/accounts")
def list_accounts(list_id: str, db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List the accounts in a list."""
    ul = _list_or_404(db, list_id, account.id)
    accounts = db.scalars(
        select(Account)
        .join(UserListAccount, UserListAccount.account_id == Account.id)
        .where(UserListAccount.list_id == ul.id)
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.post("/api/v1/lists/{list_id}/accounts", status_code=200)
async def add_accounts(list_id: str, request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Add accounts to a list."""
    ul = _list_or_404(db, list_id, account.id)
    for raw in await _account_ids(request):
        aid = _to_int(raw)
        if aid is None:
            continue
        exists = db.scalar(
            select(UserListAccount).where(UserListAccount.list_id == ul.id, UserListAccount.account_id == aid)
        )
        if exists is None:
            db.add(UserListAccount(list_id=ul.id, account_id=aid))
    db.commit()
    return {}


@router.delete("/api/v1/lists/{list_id}/accounts", status_code=200)
async def remove_accounts(list_id: str, request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove accounts from a list."""
    ul = _list_or_404(db, list_id, account.id)
    for raw in await _account_ids(request):
        aid = _to_int(raw)
        if aid is None:
            continue
        db.query(UserListAccount).filter(UserListAccount.list_id == ul.id, UserListAccount.account_id == aid).delete()
    db.commit()
    return {}


async def _account_ids(request: Request) -> list[str]:
    """Extract ``account_ids[]`` from query or body."""
    ids = request.query_params.getlist("account_ids[]") or request.query_params.getlist("account_ids")
    if ids:
        return list(ids)
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            body = await request.json()
            value = body.get("account_ids", [])
            return [str(v) for v in value]
        except Exception:
            return []
    try:
        form = await request.form()
        return [str(v) for v in form.getlist("account_ids[]")] or [str(v) for v in form.getlist("account_ids")]
    except Exception:
        return []


def _list_or_404(db: DbSession, list_id: str, account_id: int) -> UserList:
    """Fetch a list owned by the account or raise 404."""
    try:
        ul = db.get(UserList, int(list_id))
    except (ValueError, TypeError):
        ul = None
    if ul is None or ul.account_id != account_id:
        raise HTTPException(status_code=404, detail="Record not found")
    return ul


def _to_int(value: Any) -> int | None:
    """Best-effort int coercion."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return None
