"""Mutes, blocks, follow requests, and domain blocks."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException, Request
from sqlalchemy import select

from mastodon_mock.db.models import Account, DomainBlock, Relationship
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.pagination import parse_db_id
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.relationships import serialize_relationship
from mastodon_mock.services import find_relationship, get_or_create_relationship

router = APIRouter()


@router.get("/api/v1/mutes")
def mutes(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List accounts the authed user mutes."""
    accounts = db.scalars(
        select(Account)
        .join(Relationship, Relationship.target_account_id == Account.id)
        .where(Relationship.source_account_id == account.id, Relationship.muting.is_(True))
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.get("/api/v1/blocks")
def blocks(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List accounts the authed user blocks."""
    accounts = db.scalars(
        select(Account)
        .join(Relationship, Relationship.target_account_id == Account.id)
        .where(Relationship.source_account_id == account.id, Relationship.blocking.is_(True))
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.get("/api/v1/follow_requests")
def follow_requests(db: DbSession, config: Config, account: RequiredAccount) -> list[dict[str, Any]]:
    """List accounts with a pending follow request toward the authed user."""
    accounts = db.scalars(
        select(Account)
        .join(Relationship, Relationship.target_account_id == Account.id)
        .where(Relationship.source_account_id == account.id, Relationship.requested_by.is_(True))
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.post("/api/v1/follow_requests/{account_id}/authorize")
def authorize_follow_request(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Authorize a pending incoming follow request."""
    requester = _account_or_404(db, account_id)
    # requester -> me: flip requested -> following
    forward = get_or_create_relationship(db, requester.id, account.id)
    forward.requested = False
    forward.following = True
    # me -> requester: flip requested_by -> followed_by
    backward = get_or_create_relationship(db, account.id, requester.id)
    backward.requested_by = False
    backward.followed_by = True
    db.commit()
    return serialize_relationship(db, requester.id, backward, source_id=account.id)


@router.post("/api/v1/follow_requests/{account_id}/reject")
def reject_follow_request(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Reject a pending incoming follow request."""
    requester = _account_or_404(db, account_id)
    forward = find_relationship(db, requester.id, account.id)
    if forward is not None:
        forward.requested = False
    backward = get_or_create_relationship(db, account.id, requester.id)
    backward.requested_by = False
    db.commit()
    return serialize_relationship(db, requester.id, backward, source_id=account.id)


@router.get("/api/v1/domain_blocks")
def domain_blocks(db: DbSession, account: RequiredAccount) -> list[str]:
    """List blocked domains."""
    rows = db.scalars(select(DomainBlock).where(DomainBlock.account_id == account.id)).all()
    return [r.domain for r in rows]


@router.post("/api/v1/domain_blocks", status_code=200)
def domain_block(db: DbSession, account: RequiredAccount, domain: Annotated[str, Form()]) -> dict[str, Any]:
    """Block a domain."""
    exists = db.scalar(select(DomainBlock).where(DomainBlock.account_id == account.id, DomainBlock.domain == domain))
    if exists is None:
        db.add(DomainBlock(account_id=account.id, domain=domain))
    db.commit()
    return {}


@router.delete("/api/v1/domain_blocks", status_code=200)
async def domain_unblock(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Unblock a domain."""
    domain: str | None = None
    if request.query_params.get("domain"):
        domain = request.query_params["domain"]
    else:
        try:
            form = await request.form()
            raw = form.get("domain")
            domain = str(raw) if isinstance(raw, str) else None
        except Exception:
            domain = None
    if domain:
        exists = db.scalar(
            select(DomainBlock).where(DomainBlock.account_id == account.id, DomainBlock.domain == domain)
        )
        if exists is not None:
            db.delete(exists)
            db.commit()
    return {}


def _account_or_404(db: DbSession, account_id: str) -> Account:
    """Fetch an account or raise 404."""
    pid = parse_db_id(account_id)
    acc = db.get(Account, pid) if pid is not None else None
    if acc is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return acc
