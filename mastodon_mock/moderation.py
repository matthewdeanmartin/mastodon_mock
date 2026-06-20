"""Observable effects of persisted account and domain moderation state."""

from __future__ import annotations

import hashlib
import ipaddress

from sqlalchemy import select
from sqlalchemy.orm import Session

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.models import (
    Account,
    AdminCanonicalEmailBlock,
    AdminDomainAllow,
    AdminDomainBlock,
    AdminEmailDomainBlock,
    AdminIpBlock,
    Relationship,
    utcnow,
)


def account_is_active(account: Account) -> bool:
    """Whether an account may authenticate and perform writes."""
    return account.approved and not account.disabled and not account.suspended


def account_is_discoverable(
    session: Session,
    account: Account,
    config: MastodonMockConfig,
    viewer: Account | None = None,
) -> bool:
    """Whether an account belongs in public timelines, search, and suggestions."""
    if viewer is not None and viewer.id == account.id:
        return True
    if config.moderation.enforce_actions:
        if not account.approved or account.disabled or account.suspended:
            return False
        if account.silenced:
            if viewer is None:
                return False
            relationship = session.scalar(
                select(Relationship).where(
                    Relationship.source_account_id == viewer.id,
                    Relationship.target_account_id == account.id,
                )
            )
            if relationship is None or not relationship.following:
                return False
    return not (account.domain and domain_is_blocked(session, account.domain, config))


def domain_is_blocked(session: Session, domain: str, config: MastodonMockConfig) -> bool:
    """Whether a remote domain is unavailable to public discovery."""
    block = session.scalar(select(AdminDomainBlock).where(AdminDomainBlock.domain == domain))
    if block is not None:
        return True
    if config.moderation.enforce_domain_allows:
        return session.scalar(select(AdminDomainAllow).where(AdminDomainAllow.domain == domain)) is None
    return False


def signup_block_reason(session: Session, email: str, ip: str | None) -> str | None:
    """Return a human-readable reason when signup email/IP controls reject input."""
    domain = email.strip().lower().partition("@")[2]
    if domain and session.scalar(select(AdminEmailDomainBlock).where(AdminEmailDomainBlock.domain == domain)):
        return "Email domain is blocked"

    digest = canonicalize_email(email)
    if session.scalar(select(AdminCanonicalEmailBlock).where(AdminCanonicalEmailBlock.canonical_email_hash == digest)):
        return "Email address is blocked"

    if ip:
        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            address = None
        if address is not None:
            blocks = session.scalars(select(AdminIpBlock)).all()
            for block in blocks:
                if block.expires_at is not None and block.expires_at <= utcnow():
                    continue
                try:
                    network = ipaddress.ip_network(block.ip, strict=False)
                except ValueError:
                    continue
                if address in network:
                    return "IP address is blocked"
    return None


def domain_rejects_reports(session: Session, domain: str | None) -> bool:
    """Whether an instance-wide domain block rejects reports from a remote domain."""
    if domain is None:
        return False
    block = session.scalar(select(AdminDomainBlock).where(AdminDomainBlock.domain == domain))
    return bool(block and block.reject_reports)


def canonicalize_email(email: str) -> str:
    """Canonicalize then SHA256-hash an email, per Mastodon's email helper."""
    local, _, domain = email.strip().lower().partition("@")
    local = local.split("+", 1)[0].replace(".", "")
    return hashlib.sha256(f"{local}@{domain}".encode()).hexdigest()
