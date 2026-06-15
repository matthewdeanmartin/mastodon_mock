"""Serialize admin/moderation ORM rows to Mastodon admin entity JSON.

See spec/03-api-coverage.md "admin" and Mastodon.py ``mastodon/admin.py``. These
shapes target Mastodon 4.x (the versions the mock pins); e.g. ``AdminAccount.role``
is a ``Role`` entity (4.0.0+), not the legacy string.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import (
    Account,
    AdminCanonicalEmailBlock,
    AdminDomainAllow,
    AdminDomainBlock,
    AdminEmailDomainBlock,
    AdminIpBlock,
    Report,
    Status,
)
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import iso, sid

# Coarse permission bitmask per role, mirroring Mastodon's default roles.
_ROLE_PERMISSIONS = {
    "user": "0",
    "moderator": "65536",  # PermissionFlags::MANAGE_REPORTS, roughly
    "admin": "1048575",  # all permissions
    "owner": "1048575",
}


def serialize_role(role: str) -> dict[str, Any]:
    """Serialize an account ``role`` string into a Mastodon ``Role`` entity."""
    name = role if role in _ROLE_PERMISSIONS else "user"
    highlighted = name in ("admin", "moderator", "owner")
    return {
        "id": {"user": "-99", "moderator": "1", "admin": "3", "owner": "0"}.get(name, "-99"),
        "name": "" if name == "user" else name.capitalize(),
        "permissions": _ROLE_PERMISSIONS[name],
        "color": "",
        "highlighted": highlighted,
    }


def _admin_status(account: Account) -> str:
    """Derive the AdminAccount-style moderation status string for an account."""
    if account.suspended:
        return "suspended"
    if not account.approved:
        return "pending"
    if account.disabled:
        return "disabled"
    if account.silenced:
        return "silenced"
    return "active"


def serialize_admin_account(session: Session, account: Account, config: MastodonMockConfig) -> dict[str, Any]:
    """Serialize an ``Account`` into the admin ``AdminAccount`` entity."""
    email = account.email or (f"{account.username}@{config.domain}" if account.domain is None else "")
    return {
        "id": sid(account.id),
        "username": account.username,
        "domain": account.domain,
        "created_at": iso(account.created_at),
        "email": email,
        "ip": account.ip,
        "ips": [{"ip": account.ip, "used_at": iso(account.created_at)}] if account.ip else [],
        "locale": account.locale or "en",
        "invite_request": account.invite_request,
        "role": serialize_role(account.role),
        "confirmed": account.confirmed,
        "approved": account.approved,
        "disabled": account.disabled,
        "silenced": account.silenced,
        "suspended": account.suspended,
        "sensitized": account.sensitized,
        "account": serialize_account(session, account, config),
        "created_by_application_id": None,
        "invited_by_account_id": None,
    }


def serialize_admin_report(session: Session, report: Report, config: MastodonMockConfig) -> dict[str, Any]:
    """Serialize a ``Report`` into the admin ``AdminReport`` entity."""
    reporter = session.get(Account, report.account_id)
    target = session.get(Account, report.target_account_id)
    assigned = session.get(Account, report.assigned_account_id) if report.assigned_account_id else None
    acted_by = session.get(Account, report.action_taken_by_account_id) if report.action_taken_by_account_id else None

    from mastodon_mock.serializers.statuses import serialize_status

    statuses: list[dict[str, Any]] = []
    for status_id in report.status_ids or []:
        status = session.get(Status, int(status_id))
        if status is not None:
            statuses.append(serialize_status(session, status, config, None))

    return {
        "id": sid(report.id),
        "action_taken": report.action_taken,
        "action_taken_at": iso(report.action_taken_at),
        "category": report.category,
        "comment": report.comment,
        "forwarded": report.forwarded,
        "created_at": iso(report.created_at),
        "updated_at": iso(report.updated_at),
        "account": serialize_admin_account(session, reporter, config) if reporter else None,
        "target_account": serialize_admin_account(session, target, config) if target else None,
        "assigned_account": serialize_admin_account(session, assigned, config) if assigned else None,
        "action_taken_by_account": serialize_admin_account(session, acted_by, config) if acted_by else None,
        "statuses": statuses,
        "rules": [],
    }


def serialize_report(session: Session, report: Report, config: MastodonMockConfig) -> dict[str, Any]:
    """Serialize a ``Report`` into the consumer-facing ``Report`` entity.

    Returned by ``POST /api/v1/reports`` (the reporter's own view), which carries
    less detail than the admin ``AdminReport``.
    """
    target = session.get(Account, report.target_account_id)
    return {
        "id": sid(report.id),
        "action_taken": report.action_taken,
        "action_taken_at": iso(report.action_taken_at),
        "category": report.category,
        "comment": report.comment,
        "forwarded": report.forwarded,
        "created_at": iso(report.created_at),
        "status_ids": [sid(s) for s in (report.status_ids or [])],
        "rule_ids": [sid(r) for r in (report.rule_ids or [])] or None,
        "target_account": serialize_account(session, target, config) if target else None,
    }


def serialize_admin_domain_block(block: AdminDomainBlock) -> dict[str, Any]:
    """Serialize an ``AdminDomainBlock`` row."""
    return {
        "id": sid(block.id),
        "domain": block.domain,
        "created_at": iso(block.created_at),
        "severity": block.severity,
        "reject_media": block.reject_media,
        "reject_reports": block.reject_reports,
        "private_comment": block.private_comment,
        "public_comment": block.public_comment,
        "obfuscate": block.obfuscate,
        "digest": None,
    }


def serialize_admin_domain_allow(allow: AdminDomainAllow) -> dict[str, Any]:
    """Serialize an ``AdminDomainAllow`` row."""
    return {
        "id": sid(allow.id),
        "domain": allow.domain,
        "created_at": iso(allow.created_at),
    }


def serialize_admin_email_domain_block(block: AdminEmailDomainBlock) -> dict[str, Any]:
    """Serialize an ``AdminEmailDomainBlock`` row."""
    return {
        "id": sid(block.id),
        "domain": block.domain,
        "created_at": iso(block.created_at),
        "history": [],
    }


def serialize_admin_canonical_email_block(block: AdminCanonicalEmailBlock) -> dict[str, Any]:
    """Serialize an ``AdminCanonicalEmailBlock`` row."""
    return {
        "id": sid(block.id),
        "canonical_email_hash": block.canonical_email_hash,
    }


def serialize_admin_ip_block(block: AdminIpBlock) -> dict[str, Any]:
    """Serialize an ``AdminIpBlock`` row."""
    return {
        "id": sid(block.id),
        "ip": block.ip,
        "severity": block.severity,
        "comment": block.comment,
        "created_at": iso(block.created_at),
        "expires_at": iso(block.expires_at),
    }
