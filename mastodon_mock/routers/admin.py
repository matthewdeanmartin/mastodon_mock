"""Admin / moderation API (``/api/v1/admin/*``, ``/api/v2/admin/*``).

See spec/03-api-coverage.md "admin". Auth is faked like the rest of the mock:
any authenticated account may call these endpoints (no role enforcement), matching
the project's "no real security" non-goal in spec/00-overview.md.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import (
    Account,
    AdminCanonicalEmailBlock,
    AdminDomainAllow,
    AdminDomainBlock,
    AdminEmailDomainBlock,
    AdminIpBlock,
    Report,
    Status,
    utcnow,
)
from mastodon_mock.deps import Config, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, read_body, set_link_header
from mastodon_mock.serializers.admin import (
    serialize_admin_account,
    serialize_admin_canonical_email_block,
    serialize_admin_domain_allow,
    serialize_admin_domain_block,
    serialize_admin_email_domain_block,
    serialize_admin_ip_block,
    serialize_admin_report,
    serialize_report,
)
from mastodon_mock.serializers.statuses import serialize_status

router = APIRouter()


def _record_or_404(db: Session, model: Any, record_id: str) -> Any:
    """Fetch a row by string id or raise a Mastodon-shaped 404."""
    try:
        row = db.get(model, int(record_id))
    except (ValueError, TypeError):
        row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return row


# --- Accounts -----------------------------------------------------------------


def _apply_account_status_filter(accounts: list[Account], status: str) -> list[Account]:
    """Filter accounts by the AdminAccount moderation status string."""

    def matches(account: Account) -> bool:
        if status == "active":
            return account.approved and not account.suspended and not account.disabled and not account.silenced
        if status == "pending":
            return not account.approved
        if status == "disabled":
            return account.disabled
        if status == "silenced":
            return account.silenced
        if status == "suspended":
            return account.suspended
        return True

    return [a for a in accounts if matches(a)]


@router.get("/api/v2/admin/accounts")
def admin_accounts_v2(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List accounts matching moderation criteria (v2)."""
    qp = request.query_params
    stmt = select(Account)

    # Default to local accounts when no origin is given (matches the real API).
    origin = qp.get("origin") or "local"
    if origin == "local":
        stmt = stmt.where(Account.domain.is_(None))
    elif origin == "remote":
        stmt = stmt.where(Account.domain.is_not(None))

    if qp.get("by_domain"):
        stmt = stmt.where(Account.domain == qp["by_domain"])
    if qp.get("username"):
        stmt = stmt.where(Account.username.contains(qp["username"]))
    if qp.get("display_name"):
        stmt = stmt.where(Account.display_name.contains(qp["display_name"]))
    if qp.get("email"):
        stmt = stmt.where(Account.email == qp["email"])
    if qp.get("ip"):
        stmt = stmt.where(Account.ip == qp["ip"])
    if qp.get("permissions") == "staff":
        stmt = stmt.where(Account.role.in_(["moderator", "admin", "owner"]))

    result = paginate(
        db, stmt, Account.id, max_id=page.max_id, min_id=page.min_id, since_id=page.since_id, limit=page.limit
    )
    items = _apply_account_status_filter(list(result.items), qp.get("status") or "active")
    set_link_header(request, response, result)
    return [serialize_admin_account(db, a, config) for a in items]


@router.get("/api/v1/admin/accounts")
def admin_accounts_v1(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List accounts matching moderation criteria (v1, deprecated upstream)."""
    qp = request.query_params
    stmt = select(Account)

    # v1 uses boolean flags (remote/local) rather than an `origin` string.
    stmt = stmt.where(Account.domain.is_not(None) if qp.get("remote") else Account.domain.is_(None))

    if qp.get("by_domain"):
        stmt = stmt.where(Account.domain == qp["by_domain"])
    if qp.get("username"):
        stmt = stmt.where(Account.username.contains(qp["username"]))
    if qp.get("display_name"):
        stmt = stmt.where(Account.display_name.contains(qp["display_name"]))
    if qp.get("email"):
        stmt = stmt.where(Account.email == qp["email"])
    if qp.get("ip"):
        stmt = stmt.where(Account.ip == qp["ip"])
    if qp.get("staff"):
        stmt = stmt.where(Account.role.in_(["moderator", "admin", "owner"]))

    # v1 status is encoded as `active=true`/`pending=true`/etc.
    status = "active"
    for candidate in ("active", "pending", "disabled", "silenced", "suspended"):
        if qp.get(candidate):
            status = candidate

    result = paginate(
        db, stmt, Account.id, max_id=page.max_id, min_id=page.min_id, since_id=page.since_id, limit=page.limit
    )
    items = _apply_account_status_filter(list(result.items), status)
    set_link_header(request, response, result)
    return [serialize_admin_account(db, a, config) for a in items]


@router.get("/api/v1/admin/accounts/{account_id}")
def admin_account(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single admin account."""
    target = _record_or_404(db, Account, account_id)
    return serialize_admin_account(db, target, config)


@router.post("/api/v1/admin/accounts/{account_id}/enable")
def admin_account_enable(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Re-enable a disabled local account."""
    target = _record_or_404(db, Account, account_id)
    target.disabled = False
    db.commit()
    return serialize_admin_account(db, target, config)


@router.post("/api/v1/admin/accounts/{account_id}/approve")
def admin_account_approve(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Approve a pending account."""
    target = _record_or_404(db, Account, account_id)
    target.approved = True
    db.commit()
    return serialize_admin_account(db, target, config)


@router.post("/api/v1/admin/accounts/{account_id}/reject")
def admin_account_reject(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Reject (and delete) a pending account; returns the now-deleted account."""
    target = _record_or_404(db, Account, account_id)
    data = serialize_admin_account(db, target, config)
    db.delete(target)
    db.commit()
    return data


@router.post("/api/v1/admin/accounts/{account_id}/unsilence")
def admin_account_unsilence(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unsilence an account."""
    target = _record_or_404(db, Account, account_id)
    target.silenced = False
    db.commit()
    return serialize_admin_account(db, target, config)


@router.post("/api/v1/admin/accounts/{account_id}/unsuspend")
def admin_account_unsuspend(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unsuspend an account."""
    target = _record_or_404(db, Account, account_id)
    target.suspended = False
    db.commit()
    return serialize_admin_account(db, target, config)


@router.post("/api/v1/admin/accounts/{account_id}/unsensitive")
def admin_account_unsensitive(
    account_id: str, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Clear the force-sensitive flag on an account."""
    target = _record_or_404(db, Account, account_id)
    target.sensitized = False
    db.commit()
    return serialize_admin_account(db, target, config)


@router.delete("/api/v1/admin/accounts/{account_id}")
def admin_account_delete(account_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Delete a local account; returns its (pre-delete) admin shape."""
    target = _record_or_404(db, Account, account_id)
    data = serialize_admin_account(db, target, config)
    db.delete(target)
    db.commit()
    return data


@router.post("/api/v1/admin/accounts/{account_id}/action", status_code=200)
async def admin_account_moderate(
    account_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Apply a moderation action (``type``: disable/silence/suspend/sensitive)."""
    target = _record_or_404(db, Account, account_id)
    body = await read_body(request)
    action = body.get("type") or "none"

    if action == "disable":
        target.disabled = True
    elif action == "silence":
        target.silenced = True
    elif action == "suspend":
        target.suspended = True
    elif action == "sensitive":
        target.sensitized = True
    # `none` issues only a warning — no state change.

    report_id = body.get("report_id")
    if report_id:
        report = db.get(Report, int(report_id))
        if report is not None:
            report.action_taken = True
            report.action_taken_at = utcnow()
            report.action_taken_by_account_id = account.id
            report.updated_at = utcnow()
    db.commit()
    # Mastodon.py expects an empty body here (return type None).
    return {}


# --- Reports ------------------------------------------------------------------
# The consumer-facing create endpoint lives here too: it is what populates the
# admin report queue. ``POST /api/v1/reports`` returns the (non-admin) Report.


@router.post("/api/v1/reports/", status_code=200)
@router.post("/api/v1/reports", status_code=200)
async def create_report(request: Request, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """File a moderation report against an account (``report()``)."""
    body = await read_body(request)
    target_id = body.get("account_id")
    if not target_id:
        raise HTTPException(status_code=422, detail="Validation failed: Target account is required")
    target = _record_or_404(db, Account, str(target_id))

    category = body.get("category") or "other"
    if category not in ("spam", "violation", "other"):
        raise HTTPException(status_code=422, detail="Validation failed: Invalid category")

    raw_status_ids = body.get("status_ids") or []
    if isinstance(raw_status_ids, (str, int)):
        raw_status_ids = [raw_status_ids]
    status_ids = [int(s) for s in raw_status_ids]

    raw_rule_ids = body.get("rule_ids") or []
    if isinstance(raw_rule_ids, (str, int)):
        raw_rule_ids = [raw_rule_ids]
    rule_ids = [int(r) for r in raw_rule_ids]

    report = Report(
        account_id=account.id,
        target_account_id=target.id,
        comment=body.get("comment") or "",
        category=category,
        forwarded=_as_bool(body.get("forward")),
        status_ids=status_ids,
        rule_ids=rule_ids,
    )
    db.add(report)
    db.commit()
    return serialize_report(db, report, config)


@router.get("/api/v1/admin/reports")
def admin_reports(
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List moderation reports."""
    qp = request.query_params
    stmt = select(Report)
    # `resolved` is sent only when True (Mastodon.py drops the falsy value).
    if qp.get("resolved"):
        stmt = stmt.where(Report.action_taken.is_(True))
    else:
        stmt = stmt.where(Report.action_taken.is_(False))
    if qp.get("account_id"):
        stmt = stmt.where(Report.account_id == int(qp["account_id"]))
    if qp.get("target_account_id"):
        stmt = stmt.where(Report.target_account_id == int(qp["target_account_id"]))

    result = paginate(
        db, stmt, Report.id, max_id=page.max_id, min_id=page.min_id, since_id=page.since_id, limit=page.limit
    )
    set_link_header(request, response, result)
    return [serialize_admin_report(db, r, config) for r in result.items]


@router.get("/api/v1/admin/reports/{report_id}")
def admin_report(report_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single report."""
    report = _record_or_404(db, Report, report_id)
    return serialize_admin_report(db, report, config)


@router.post("/api/v1/admin/reports/{report_id}/assign_to_self")
def admin_report_assign(report_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Assign a report to the calling moderator."""
    report = _record_or_404(db, Report, report_id)
    report.assigned_account_id = account.id
    report.updated_at = utcnow()
    db.commit()
    return serialize_admin_report(db, report, config)


@router.post("/api/v1/admin/reports/{report_id}/unassign")
def admin_report_unassign(report_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unassign a report."""
    report = _record_or_404(db, Report, report_id)
    report.assigned_account_id = None
    report.updated_at = utcnow()
    db.commit()
    return serialize_admin_report(db, report, config)


@router.post("/api/v1/admin/reports/{report_id}/reopen")
def admin_report_reopen(report_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Reopen a resolved report."""
    report = _record_or_404(db, Report, report_id)
    report.action_taken = False
    report.action_taken_at = None
    report.action_taken_by_account_id = None
    report.updated_at = utcnow()
    db.commit()
    return serialize_admin_report(db, report, config)


@router.post("/api/v1/admin/reports/{report_id}/resolve")
def admin_report_resolve(report_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Mark a report resolved (no action taken)."""
    report = _record_or_404(db, Report, report_id)
    report.action_taken = True
    report.action_taken_at = utcnow()
    report.action_taken_by_account_id = account.id
    report.updated_at = utcnow()
    db.commit()
    return serialize_admin_report(db, report, config)


# --- Trends -------------------------------------------------------------------
# Admin trending tags/statuses reuse the public, data-derived trends logic (see
# routers/instance.py) and re-shape it for the admin API. Trending links stay
# Stub (no preview-card synthesis). The approve/reject endpoints echo back a
# minimal entity so callers don't error.


@router.get("/api/v1/admin/trends/tags")
def admin_trending_tags(
    db: DbSession, config: Config, account: RequiredAccount, limit: int = 10
) -> list[dict[str, Any]]:
    """Admin trending tags — local hashtags ranked by usage, in the AdminTag shape."""
    from mastodon_mock.routers.instance import trending_tag_rows

    return [
        {**tag, "requires_review": False, "trendable": True, "usable": True}
        for tag in trending_tag_rows(db, config, min(limit, 20))
    ]


@router.get("/api/v1/admin/trends/statuses")
def admin_trending_statuses(
    db: DbSession, config: Config, account: RequiredAccount, limit: int = 20
) -> list[dict[str, Any]]:
    """Admin trending statuses — the most-favourited public local statuses."""
    from mastodon_mock.routers.instance import trending_status_rows

    return trending_status_rows(db, config, account, min(limit, 40))


@router.get("/api/v1/admin/trends/links")
def admin_trending_links(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """Admin trending links — empty (trends are Stub)."""
    return []


@router.post("/api/v1/admin/trends/links/{link_id}/approve")
def admin_approve_trending_link(link_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Approve a trending link (echo minimal PreviewCard)."""
    return {"url": "", "title": "", "description": "", "type": "link"}


@router.post("/api/v1/admin/trends/links/{link_id}/reject")
def admin_reject_trending_link(link_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Reject a trending link (echo minimal PreviewCard)."""
    return {"url": "", "title": "", "description": "", "type": "link"}


@router.post("/api/v1/admin/trends/statuses/{status_id}/approve")
def admin_approve_trending_status(
    status_id: str, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Approve a trending status."""
    status = _record_or_404(db, Status, status_id)
    return serialize_status(db, status, config, account)


@router.post("/api/v1/admin/trends/statuses/{status_id}/reject")
def admin_reject_trending_status(
    status_id: str, db: DbSession, config: Config, account: RequiredAccount
) -> dict[str, Any]:
    """Reject a trending status."""
    status = _record_or_404(db, Status, status_id)
    return serialize_status(db, status, config, account)


@router.post("/api/v1/admin/trends/tags/{tag_id}/approve")
def admin_approve_trending_tag(tag_id: str, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Approve a trending tag (echo minimal Tag)."""
    return {"name": "", "url": f"https://{config.domain}/tags/"}


@router.post("/api/v1/admin/trends/tags/{tag_id}/reject")
def admin_reject_trending_tag(tag_id: str, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Reject a trending tag (echo minimal Tag)."""
    return {"name": "", "url": f"https://{config.domain}/tags/"}


# --- Domain blocks ------------------------------------------------------------


@router.get("/api/v1/admin/domain_blocks/{block_id}")
def admin_domain_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single domain block."""
    block = _record_or_404(db, AdminDomainBlock, block_id)
    return serialize_admin_domain_block(block)


@router.get("/api/v1/admin/domain_blocks/")
@router.get("/api/v1/admin/domain_blocks")
def admin_domain_blocks(
    request: Request,
    response: Response,
    db: DbSession,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List domain blocks."""
    result = paginate(
        db,
        select(AdminDomainBlock),
        AdminDomainBlock.id,
        max_id=page.max_id,
        min_id=page.min_id,
        since_id=page.since_id,
        limit=page.limit,
    )
    set_link_header(request, response, result)
    return [serialize_admin_domain_block(b) for b in result.items]


@router.post("/api/v1/admin/domain_blocks/", status_code=200)
@router.post("/api/v1/admin/domain_blocks", status_code=200)
async def admin_create_domain_block(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Create a domain block."""
    body = await read_body(request)
    domain = body.get("domain")
    if not domain:
        raise HTTPException(status_code=422, detail="Validation failed: Domain can't be blank")
    block = AdminDomainBlock(
        domain=domain,
        severity=body.get("severity") or "silence",
        reject_media=_as_bool(body.get("reject_media")),
        reject_reports=_as_bool(body.get("reject_reports")),
        private_comment=body.get("private_comment"),
        public_comment=body.get("public_comment"),
        obfuscate=_as_bool(body.get("obfuscate")),
    )
    db.add(block)
    db.commit()
    return serialize_admin_domain_block(block)


@router.put("/api/v1/admin/domain_blocks/{block_id}")
async def admin_update_domain_block(
    block_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Update an existing domain block."""
    block = _record_or_404(db, AdminDomainBlock, block_id)
    body = await read_body(request)
    if body.get("severity") is not None:
        block.severity = body["severity"]
    if body.get("reject_media") is not None:
        block.reject_media = _as_bool(body["reject_media"])
    if body.get("reject_reports") is not None:
        block.reject_reports = _as_bool(body["reject_reports"])
    if body.get("private_comment") is not None:
        block.private_comment = body["private_comment"]
    if body.get("public_comment") is not None:
        block.public_comment = body["public_comment"]
    if body.get("obfuscate") is not None:
        block.obfuscate = _as_bool(body["obfuscate"])
    db.commit()
    return serialize_admin_domain_block(block)


@router.delete("/api/v1/admin/domain_blocks/{block_id}", status_code=200)
def admin_delete_domain_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove a domain block."""
    block = _record_or_404(db, AdminDomainBlock, block_id)
    db.delete(block)
    db.commit()
    return {}


# --- Domain allows ------------------------------------------------------------


@router.get("/api/v1/admin/domain_allows/{allow_id}")
def admin_domain_allow(allow_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single domain allow."""
    allow = _record_or_404(db, AdminDomainAllow, allow_id)
    return serialize_admin_domain_allow(allow)


@router.get("/api/v1/admin/domain_allows")
def admin_domain_allows(
    request: Request,
    response: Response,
    db: DbSession,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List allowed domains."""
    result = paginate(
        db,
        select(AdminDomainAllow),
        AdminDomainAllow.id,
        max_id=page.max_id,
        min_id=page.min_id,
        since_id=page.since_id,
        limit=page.limit,
    )
    set_link_header(request, response, result)
    return [serialize_admin_domain_allow(a) for a in result.items]


@router.post("/api/v1/admin/domain_allows", status_code=200)
async def admin_create_domain_allow(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Allow a domain (idempotent: returns existing record if present)."""
    body = await read_body(request)
    domain = body.get("domain")
    if not domain:
        raise HTTPException(status_code=422, detail="Validation failed: Domain can't be blank")
    existing = db.scalar(select(AdminDomainAllow).where(AdminDomainAllow.domain == domain))
    if existing is not None:
        return serialize_admin_domain_allow(existing)
    allow = AdminDomainAllow(domain=domain)
    db.add(allow)
    db.commit()
    return serialize_admin_domain_allow(allow)


@router.delete("/api/v1/admin/domain_allows/{allow_id}", status_code=200)
def admin_delete_domain_allow(allow_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove a domain from the allowlist."""
    allow = _record_or_404(db, AdminDomainAllow, allow_id)
    db.delete(allow)
    db.commit()
    return {}


# --- Email domain blocks ------------------------------------------------------


@router.get("/api/v1/admin/email_domain_blocks/{block_id}")
def admin_email_domain_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single email domain block."""
    block = _record_or_404(db, AdminEmailDomainBlock, block_id)
    return serialize_admin_email_domain_block(block)


@router.get("/api/v1/admin/email_domain_blocks")
def admin_email_domain_blocks(
    request: Request,
    response: Response,
    db: DbSession,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List blocked email domains."""
    result = paginate(
        db,
        select(AdminEmailDomainBlock),
        AdminEmailDomainBlock.id,
        max_id=page.max_id,
        min_id=page.min_id,
        since_id=page.since_id,
        limit=page.limit,
    )
    set_link_header(request, response, result)
    return [serialize_admin_email_domain_block(b) for b in result.items]


@router.post("/api/v1/admin/email_domain_blocks", status_code=200)
async def admin_create_email_domain_block(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Block an email domain from signups."""
    body = await read_body(request)
    domain = body.get("domain")
    if not domain:
        raise HTTPException(status_code=422, detail="Validation failed: Domain can't be blank")
    block = AdminEmailDomainBlock(domain=domain)
    db.add(block)
    db.commit()
    return serialize_admin_email_domain_block(block)


@router.delete("/api/v1/admin/email_domain_blocks/{block_id}", status_code=200)
def admin_delete_email_domain_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove an email domain block."""
    block = _record_or_404(db, AdminEmailDomainBlock, block_id)
    db.delete(block)
    db.commit()
    return {}


# --- Canonical email blocks ---------------------------------------------------


def _canonicalize_email(email: str) -> str:
    """Canonicalize then SHA256-hash an email, per Mastodon's email_helper.rb."""
    local, _, domain = email.strip().lower().partition("@")
    local = local.split("+", 1)[0].replace(".", "")
    canonical = f"{local}@{domain}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@router.get("/api/v1/admin/canonical_email_blocks/{block_id}")
def admin_canonical_email_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single canonical email block."""
    block = _record_or_404(db, AdminCanonicalEmailBlock, block_id)
    return serialize_admin_canonical_email_block(block)


@router.get("/api/v1/admin/canonical_email_blocks")
def admin_canonical_email_blocks(
    request: Request,
    response: Response,
    db: DbSession,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List canonical email blocks."""
    result = paginate(
        db,
        select(AdminCanonicalEmailBlock),
        AdminCanonicalEmailBlock.id,
        max_id=page.max_id,
        min_id=page.min_id,
        since_id=page.since_id,
        limit=page.limit,
    )
    set_link_header(request, response, result)
    return [serialize_admin_canonical_email_block(b) for b in result.items]


@router.post("/api/v1/admin/canonical_email_blocks/test", status_code=200)
async def admin_test_canonical_email_block(
    request: Request, db: DbSession, account: RequiredAccount
) -> list[dict[str, Any]]:
    """Canonicalize+hash an email and return matching canonical blocks."""
    body = await read_body(request)
    email = body.get("email")
    if not email:
        return []
    digest = _canonicalize_email(email)
    matches = db.scalars(
        select(AdminCanonicalEmailBlock).where(AdminCanonicalEmailBlock.canonical_email_hash == digest)
    ).all()
    return [serialize_admin_canonical_email_block(b) for b in matches]


@router.post("/api/v1/admin/canonical_email_blocks", status_code=200)
async def admin_create_canonical_email_block(
    request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Block a canonical email by ``email`` or ``canonical_email_hash``."""
    body = await read_body(request)
    digest = body.get("canonical_email_hash")
    if not digest:
        email = body.get("email")
        if not email:
            raise HTTPException(status_code=422, detail="Either 'email' or 'canonical_email_hash' must be provided.")
        digest = _canonicalize_email(email)
    block = AdminCanonicalEmailBlock(canonical_email_hash=digest)
    db.add(block)
    db.commit()
    return serialize_admin_canonical_email_block(block)


@router.delete("/api/v1/admin/canonical_email_blocks/{block_id}", status_code=200)
def admin_delete_canonical_email_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a canonical email block; returns its shape."""
    block = _record_or_404(db, AdminCanonicalEmailBlock, block_id)
    data = serialize_admin_canonical_email_block(block)
    db.delete(block)
    db.commit()
    return data


# --- IP blocks ----------------------------------------------------------------


@router.get("/api/v1/admin/ip_blocks/{block_id}")
def admin_ip_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch a single IP block."""
    block = _record_or_404(db, AdminIpBlock, block_id)
    return serialize_admin_ip_block(block)


@router.get("/api/v1/admin/ip_blocks")
def admin_ip_blocks(
    request: Request,
    response: Response,
    db: DbSession,
    account: RequiredAccount,
    page: PageQuery,
) -> list[dict[str, Any]]:
    """List blocked IP addresses/ranges."""
    result = paginate(
        db,
        select(AdminIpBlock),
        AdminIpBlock.id,
        max_id=page.max_id,
        min_id=page.min_id,
        since_id=page.since_id,
        limit=page.limit,
    )
    set_link_header(request, response, result)
    return [serialize_admin_ip_block(b) for b in result.items]


@router.post("/api/v1/admin/ip_blocks", status_code=200)
async def admin_create_ip_block(request: Request, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Block an IP address or CIDR range."""
    body = await read_body(request)
    ip = body.get("ip")
    severity = body.get("severity")
    if not ip or not severity:
        raise HTTPException(status_code=422, detail="Validation failed: ip and severity are required")
    block = AdminIpBlock(
        ip=ip,
        severity=severity,
        comment=body.get("comment") or "",
        expires_at=_expires_at(body.get("expires_in")),
    )
    db.add(block)
    db.commit()
    return serialize_admin_ip_block(block)


@router.put("/api/v1/admin/ip_blocks/{block_id}")
async def admin_update_ip_block(
    block_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Update an existing IP block."""
    block = _record_or_404(db, AdminIpBlock, block_id)
    body = await read_body(request)
    if body.get("ip") is not None:
        block.ip = body["ip"]
    if body.get("severity") is not None:
        block.severity = body["severity"]
    if body.get("comment") is not None:
        block.comment = body["comment"]
    if body.get("expires_in") is not None:
        block.expires_at = _expires_at(body["expires_in"])
    db.commit()
    return serialize_admin_ip_block(block)


@router.delete("/api/v1/admin/ip_blocks/{block_id}", status_code=200)
def admin_delete_ip_block(block_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove an IP block."""
    block = _record_or_404(db, AdminIpBlock, block_id)
    db.delete(block)
    db.commit()
    return {}


# --- Measures / dimensions / retention ---------------------------------------
# Statistical endpoints. The mock returns correctly-shaped zero/empty data; it
# does not compute real aggregates (out of scope — see spec).


@router.post("/api/v1/admin/measures", status_code=200)
async def admin_measures(request: Request, account: RequiredAccount) -> list[dict[str, Any]]:
    """Return zero-valued measures for each requested key."""
    body = await read_body(request)
    keys = body.get("keys") or []
    if isinstance(keys, str):
        keys = [keys]
    return [
        {
            "key": key,
            "unit": None,
            "total": "0",
            "human_value": "0",
            "previous_total": "0",
            "data": [],
        }
        for key in keys
    ]


@router.post("/api/v1/admin/dimensions", status_code=200)
async def admin_dimensions(request: Request, account: RequiredAccount) -> list[dict[str, Any]]:
    """Return empty dimensions for each requested key."""
    body = await read_body(request)
    keys = body.get("keys") or []
    if isinstance(keys, str):
        keys = [keys]
    return [{"key": key, "data": []} for key in keys]


@router.post("/api/v1/admin/retention", status_code=200)
async def admin_retention(request: Request, account: RequiredAccount) -> list[dict[str, Any]]:
    """Return empty retention cohorts."""
    return []


# --- helpers ------------------------------------------------------------------


def _as_bool(value: Any) -> bool:
    """Coerce a form/JSON truthy value to bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)


def _expires_at(expires_in: Any) -> Any:
    """Convert an ``expires_in`` seconds value into an absolute datetime, or None."""
    if expires_in is None or expires_in == "":
        return None
    try:
        return utcnow() + timedelta(seconds=int(expires_in))
    except (ValueError, TypeError):
        return None
