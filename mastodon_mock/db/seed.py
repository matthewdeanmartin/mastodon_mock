"""Idempotent seed application. See spec/07-seeding-and-fixtures.md."""

from __future__ import annotations

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from mastodon_mock.config import SeedAccount, SeedAnnouncement, SeedConfig, SeedStatus
from mastodon_mock.db.models import Account, Announcement, OAuthToken, Status, utcnow
from mastodon_mock.services import attach_mentions_and_tags, do_follow

_DEFAULT_SCOPES = ["read", "write", "follow", "push"]


def apply_seed_data(engine: Engine, seed: SeedConfig) -> None:
    """Apply seed accounts, follows, and statuses idempotently."""
    with Session(engine) as session:
        username_to_account: dict[str, Account] = {}

        for spec in seed.accounts:
            account = _ensure_account(session, spec)
            username_to_account[spec.username] = account
            if spec.access_token:
                _ensure_token(session, spec.access_token, account.id)

        session.flush()

        for follow in seed.follows:
            follower = username_to_account.get(follow.follower)
            target = username_to_account.get(follow.following)
            if follower is not None and target is not None:
                do_follow(session, follower, target)

        for status_spec in seed.statuses:
            author = username_to_account.get(status_spec.account)
            if author is not None:
                _ensure_status(session, author, status_spec)

        for announcement_spec in seed.announcements:
            _ensure_announcement(session, announcement_spec)

        session.commit()


def _ensure_account(session: Session, spec: SeedAccount) -> Account:
    """Find-or-create an account matched on (username, domain)."""
    existing = session.scalar(select(Account).where(Account.username == spec.username, Account.domain == spec.domain))
    if existing is not None:
        return existing
    # Local accounts get a synthetic email for the admin API; remote accounts don't.
    email = spec.email or (f"{spec.username}@local" if spec.domain is None else None)
    account = Account(
        username=spec.username,
        domain=spec.domain,
        display_name=spec.display_name or spec.username,
        note=spec.note or "",
        locked=spec.locked,
        bot=spec.bot,
        created_at=utcnow(),
        fields=[],
        email=email,
        role=spec.role,
    )
    session.add(account)
    session.flush()
    return account


def _ensure_token(session: Session, access_token: str, account_id: int) -> None:
    """Find-or-create an oauth token matched on the token string."""
    existing = session.scalar(select(OAuthToken).where(OAuthToken.access_token == access_token))
    if existing is None:
        session.add(
            OAuthToken(
                access_token=access_token,
                account_id=account_id,
                scopes=list(_DEFAULT_SCOPES),
                created_at=utcnow(),
            )
        )


def _ensure_status(session: Session, account: Account, spec: SeedStatus) -> None:
    """Find-or-create a seed status matched on (account_id, text)."""
    existing = session.scalar(select(Status).where(Status.account_id == account.id, Status.text == spec.text))
    if existing is not None:
        return
    status = Status(
        account_id=account.id,
        content=f"<p>{spec.text}</p>",
        text=spec.text,
        visibility=spec.visibility,
        created_at=utcnow(),
        edit_history=[],
    )
    session.add(status)
    session.flush()
    attach_mentions_and_tags(session, status.id, account.id, spec.text)


def _ensure_announcement(session: Session, spec: SeedAnnouncement) -> None:
    """Find-or-create a seed announcement matched on its content."""
    existing = session.scalar(select(Announcement).where(Announcement.content == spec.content))
    if existing is not None:
        return
    now = utcnow()
    session.add(
        Announcement(
            content=spec.content,
            starts_at=spec.starts_at,
            ends_at=spec.ends_at,
            all_day=spec.all_day,
            published=spec.published,
            published_at=now,
            updated_at=now,
        )
    )
