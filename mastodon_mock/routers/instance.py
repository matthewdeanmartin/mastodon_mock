"""Instance metadata endpoints. See spec/03-api-coverage.md + 05-versioning.md."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import func, select

from mastodon_mock.db.models import (
    Account,
    AdminDomainBlock,
    Announcement,
    AnnouncementDismissal,
    AnnouncementReaction,
    Favourite,
    Relationship,
    Status,
    StatusTag,
    utcnow,
)
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import clamp_limit, clamp_offset, parse_db_id
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.announcements import (
    serialize_announcement,
    serialize_terms_of_service,
)
from mastodon_mock.serializers.discovery import (
    serialize_activity_week,
    serialize_instance_domain_block,
    serialize_suggestion,
    serialize_tag,
)
from mastodon_mock.serializers.instance import (
    serialize_instance_v1,
    serialize_instance_v2,
    serialize_nodeinfo,
)
from mastodon_mock.serializers.statuses import serialize_status_list

router = APIRouter()

# A small, fixed set of translation target languages, advertised for every
# source language. Shaped like mastodon.social's (a dict of source → targets),
# just much shorter.
_TRANSLATION_TARGETS = ["en", "es", "fr", "de", "ja", "pt"]


# Default custom emojis, returned in the real ``CustomEmoji`` shape. Configurable
# behaviour is intentionally minimal — these exist so callers that iterate emoji
# get a non-empty, correctly-shaped sample.
def _default_custom_emojis(config: Config) -> list[dict[str, Any]]:
    base = f"https://{config.domain}/custom_emojis"
    return [
        {
            "shortcode": shortcode,
            "url": f"{base}/{shortcode}.png",
            "static_url": f"{base}/{shortcode}.png",
            "visible_in_picker": True,
            "category": "mock",
            "featured": False,
        }
        for shortcode in ("mastodon", "blobcat")
    ]


def _streaming_base(request: Request) -> str:
    """The ``ws``/``wss`` form of the origin this request arrived on.

    Real Mastodon advertises a ``wss://``/``ws://`` URL here, which browser/Electron
    clients (Whalebird, Sengi, ...) use literally with the WebSocket API — a plain
    ``https://`` URL makes ``new WebSocket(url)`` throw outright (wrong scheme).
    Mastodon.py's own ``__get_streaming_base()`` already translates ``wss``/``ws``
    back to ``https``/``http`` + the same netloc before connecting (see
    ``Mastodon.py/mastodon/internals.py``), so it still lands on this same mock
    instance — no special-casing needed on the mock's side. See spec/streaming.md
    "Streaming base URL".
    """
    ws_scheme = "wss" if request.url.scheme == "https" else "ws"
    return f"{ws_scheme}://{request.url.netloc}"


@router.get("/api/v1/instance")
@router.get("/api/v1/instance/")
def instance_v1(request: Request, db: DbSession, config: Config) -> dict[str, Any]:
    """Return v1 instance info."""
    data = serialize_instance_v1(db, config)
    if config.streaming.enabled:
        data["urls"]["streaming_api"] = _streaming_base(request)
    return data


@router.get("/api/v2/instance")
@router.get("/api/v2/instance/")
def instance_v2(request: Request, db: DbSession, config: Config) -> dict[str, Any]:
    """Return v2 instance info."""
    data = serialize_instance_v2(db, config)
    if config.streaming.enabled:
        data["configuration"]["urls"]["streaming"] = _streaming_base(request)
    return data


@router.get("/api/v1/instance/activity")
def instance_activity(db: DbSession) -> list[dict[str, str]]:
    """Weekly activity for the past 12 weeks, derived from local statuses/accounts.

    Shaped like ``mastodon.social`` (``{week, statuses, logins, registrations}``
    with string values). Statuses/registrations are counted from the mock's own
    rows per week; ``logins`` is approximated as the active-account count.
    """
    now = datetime.now(timezone.utc)
    # Week boundaries: most recent first, aligned to whole days like the real API.
    this_week_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    out: list[dict[str, str]] = []
    for i in range(12):
        end = this_week_end - timedelta(weeks=i)
        start = end - timedelta(weeks=1)
        statuses = (
            db.scalar(
                select(func.count()).select_from(Status).where(Status.created_at >= start, Status.created_at < end)
            )
            or 0
        )
        registrations = (
            db.scalar(
                select(func.count())
                .select_from(Account)
                .where(Account.created_at >= start, Account.created_at < end, Account.domain.is_(None))
            )
            or 0
        )
        logins = (
            db.scalar(
                select(func.count(func.distinct(Status.account_id))).where(
                    Status.created_at >= start, Status.created_at < end
                )
            )
            or 0
        )
        out.append(serialize_activity_week(start, statuses, logins, registrations))
    return out


@router.get("/api/v1/instance/peers")
def instance_peers(db: DbSession) -> list[str]:
    """The instance's known peers: the distinct domains of "remote" accounts."""
    domains = db.scalars(select(Account.domain).where(Account.domain.is_not(None)).distinct()).all()
    return sorted(d for d in domains if d)


@router.get("/.well-known/webfinger")
def webfinger(request: Request, db: DbSession, resource: str) -> dict[str, Any]:
    """Resolve a local ``acct:user@domain`` resource.

    Mastodon apps (Whalebird, Fedistar, etc.) hit this during the add-instance flow
    to confirm an account/instance exists, even before any OAuth happens. Only local
    accounts resolve — remote-account resolution is out of scope (see spec/00-overview.md).
    """
    username, _, _domain = resource.removeprefix("acct:").partition("@")
    account = db.scalar(select(Account).where(Account.username == username, Account.domain.is_(None)))
    if account is None:
        raise HTTPException(status_code=404, detail="Record not found")
    base = f"{request.url.scheme}://{request.url.netloc}"
    return {
        "subject": f"acct:{account.username}@{request.url.hostname}",
        "aliases": [f"{base}/@{account.username}"],
        "links": [
            {
                "rel": "http://webfinger.net/rel/profile-page",
                "type": "text/html",
                "href": f"{base}/@{account.username}",
            },
            {"rel": "self", "type": "application/activity+json", "href": f"{base}/users/{account.username}"},
        ],
    }


@router.get("/.well-known/nodeinfo")
def nodeinfo_index(request: Request) -> dict[str, Any]:
    """Point at the nodeinfo 2.0 document."""
    base = f"{request.url.scheme}://{request.url.netloc}"
    return {"links": [{"rel": "http://nodeinfo.diaspora.software/ns/schema/2.0", "href": f"{base}/nodeinfo/2.0"}]}


@router.get("/nodeinfo/2.0")
def nodeinfo_doc(db: DbSession, config: Config) -> dict[str, Any]:
    """Return the nodeinfo 2.0 document."""
    return serialize_nodeinfo(db, config)


@router.get("/api/v1/instance/rules")
def instance_rules(config: Config) -> list[dict[str, Any]]:
    """Return configured instance rules (empty by default)."""
    return [{"id": str(i + 1), "text": text, "hint": ""} for i, text in enumerate(config.rules)]


@router.get("/api/v1/instance/terms_of_service")
def instance_terms_of_service(config: Config) -> dict[str, Any]:
    """Return the configured terms of service, or 404 if none is set.

    Mirrors a real instance: with ``terms_of_service`` empty in config the
    endpoint 404s (no ToS configured); set it and the ``TermsOfService`` entity
    is returned.
    """
    if not config.terms_of_service:
        raise HTTPException(status_code=404, detail="Not found")
    return serialize_terms_of_service(config)


@router.get("/api/v1/instance/terms_of_service/{date}")
def instance_terms_of_service_revision(date: str, config: Config) -> dict[str, Any]:
    """Return a historical revision of the terms of service.

    The mock keeps no revision history, so any ``date`` resolves to the single
    currently-configured ``TermsOfService`` (404 if none is set).
    """
    del date
    if not config.terms_of_service:
        raise HTTPException(status_code=404, detail="Not found")
    return serialize_terms_of_service(config)


@router.get("/api/v1/instance/privacy_policy")
def instance_privacy_policy(config: Config) -> dict[str, Any]:
    """Return the configured privacy policy, or 404 if none is set."""
    if not config.privacy_policy:
        raise HTTPException(status_code=404, detail="Not found")
    return {"updated_at": None, "content": config.privacy_policy}


@router.get("/api/v1/directory")
def instance_directory(
    db: DbSession,
    config: Config,
    offset: int = 0,
    limit: int = 40,
    order: str = "active",
    local: bool = False,
) -> list[dict[str, Any]]:
    """List accounts in the profile directory.

    ``order=active`` (Mastodon's default) sorts by most recent activity — the
    account's latest status time, newest first, with never-posted accounts last.
    ``order=new`` sorts by account creation time, newest first.
    """
    query = db.query(Account)
    if local:
        query = query.filter(Account.domain.is_(None))

    if order == "new":
        query = query.order_by(Account.created_at.desc())
    else:  # "active" (default): most-recently-active first
        last_status_at = (
            select(func.max(Status.created_at))
            .where(Status.account_id == Account.id, Status.reblog_of_id.is_(None))
            .scalar_subquery()
        )
        # COALESCE to the account's own creation time so never-posted accounts
        # still sort deterministically (below those who have posted).
        activity = func.coalesce(last_status_at, Account.created_at)
        query = query.order_by(activity.desc(), Account.id.desc())

    query = query.offset(clamp_offset(offset)).limit(clamp_limit(limit, maximum=80))
    return [serialize_account(db, acc, config) for acc in query.all()]


@router.get("/api/v1/custom_emojis")
def custom_emojis(config: Config) -> list[dict[str, Any]]:
    """A small, correctly-shaped set of custom emojis."""
    return _default_custom_emojis(config)


def _announcement_or_404(db: DbSession, announcement_id: str) -> Announcement:
    """Fetch an announcement by id or raise 404."""
    pid = parse_db_id(announcement_id)
    announcement = db.get(Announcement, pid) if pid is not None else None
    if announcement is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return announcement


@router.get("/api/v1/announcements")
def announcements(db: DbSession, viewer: CurrentAccount) -> list[dict[str, Any]]:
    """Currently active (published) announcements, newest first.

    ``read`` is viewer-relative; for an unauthenticated caller it is always
    ``False`` (nothing dismissed).
    """
    rows = db.scalars(
        select(Announcement).where(Announcement.published.is_(True)).order_by(Announcement.id.desc())
    ).all()
    return [serialize_announcement(a, viewer) for a in rows]


@router.post("/api/v1/announcements/{announcement_id}/dismiss", status_code=200)
def announcement_dismiss(announcement_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Mark an announcement as read for the logged-in user (idempotent)."""
    announcement = _announcement_or_404(db, announcement_id)
    existing = db.scalar(
        select(AnnouncementDismissal).where(
            AnnouncementDismissal.announcement_id == announcement.id,
            AnnouncementDismissal.account_id == account.id,
        )
    )
    if existing is None:
        db.add(AnnouncementDismissal(announcement_id=announcement.id, account_id=account.id))
        db.commit()
    return {}


@router.put("/api/v1/announcements/{announcement_id}/reactions/{reaction}", status_code=200)
def announcement_add_reaction(
    announcement_id: str, reaction: str, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Add the logged-in user's reaction to an announcement (idempotent)."""
    announcement = _announcement_or_404(db, announcement_id)
    existing = db.scalar(
        select(AnnouncementReaction).where(
            AnnouncementReaction.announcement_id == announcement.id,
            AnnouncementReaction.account_id == account.id,
            AnnouncementReaction.name == reaction,
        )
    )
    if existing is None:
        db.add(AnnouncementReaction(announcement_id=announcement.id, account_id=account.id, name=reaction))
        announcement.updated_at = utcnow()
        db.commit()
    return {}


@router.delete("/api/v1/announcements/{announcement_id}/reactions/{reaction}", status_code=200)
def announcement_remove_reaction(
    announcement_id: str, reaction: str, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Remove the logged-in user's reaction from an announcement (idempotent)."""
    announcement = _announcement_or_404(db, announcement_id)
    existing = db.scalar(
        select(AnnouncementReaction).where(
            AnnouncementReaction.announcement_id == announcement.id,
            AnnouncementReaction.account_id == account.id,
            AnnouncementReaction.name == reaction,
        )
    )
    if existing is not None:
        db.delete(existing)
        announcement.updated_at = utcnow()
        db.commit()
    return {}


@router.get("/api/v1/instance/extended_description")
def instance_extended_description() -> dict[str, Any]:
    """Static placeholder extended description."""
    return {"updated_at": None, "content": ""}


@router.get("/api/v1/instance/translation_languages")
def instance_translation_languages() -> dict[str, list[str]]:
    """Map each supported source language to its translation targets.

    Shaped like the real API (``{source: [targets...]}``); the mock advertises a
    small fixed target set for each source.
    """
    return {src: [t for t in _TRANSLATION_TARGETS if t != src] for src in _TRANSLATION_TARGETS}


@router.get("/api/v1/instance/domain_blocks")
def instance_domain_blocks(db: DbSession) -> list[dict[str, Any]]:
    """Public list of instance domain blocks, derived from admin domain blocks."""
    blocks = db.scalars(select(AdminDomainBlock).order_by(AdminDomainBlock.domain)).all()
    return [serialize_instance_domain_block(b.domain, b.severity, b.public_comment) for b in blocks]


@router.get("/api/v1/instance/languages")
def instance_languages() -> list[str]:
    """Static: English only."""
    return ["en"]


# --- Discovery: suggestions / trends / endorsements / tags -------------------
# These are derived from the mock's own local data so they return realistic,
# correctly-shaped content rather than bare empty lists. See spec/03-api-coverage.md.


def _suggestion_accounts(db: DbSession, config: Config, account: Account | None, limit: int) -> list[dict[str, Any]]:
    """Serialized accounts to suggest: local, not self, not already followed."""
    stmt = select(Account).where(Account.domain.is_(None))
    if account is not None:
        stmt = stmt.where(Account.id != account.id)
        following = select(Relationship.target_account_id).where(
            Relationship.source_account_id == account.id, Relationship.following.is_(True)
        )
        stmt = stmt.where(Account.id.not_in(following))
    accounts = db.scalars(stmt.order_by(Account.id.desc()).limit(clamp_limit(limit, maximum=80))).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.get("/api/v1/suggestions")
def suggestions_v1(
    db: DbSession,
    config: Config,
    account: CurrentAccount,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Follow suggestions (v1): bare accounts the viewer doesn't already follow."""
    return _suggestion_accounts(db, config, account, limit)


@router.get("/api/v2/suggestions")
def suggestions_v2(
    db: DbSession,
    config: Config,
    account: CurrentAccount,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Follow suggestions (v2): each account wrapped in a ``Suggestion``."""
    return [serialize_suggestion(acc) for acc in _suggestion_accounts(db, config, account, limit)]


@router.delete("/api/v1/suggestions/{account_id}", status_code=200)
def suggestion_delete(account_id: str, account: RequiredAccount) -> dict[str, Any]:
    """Dismiss a follow suggestion. Suggestions are derived, not stored, so this is a no-op accept."""
    del account_id, account
    return {}


def trending_tag_rows(db: DbSession, config: Config, limit: int, offset: int = 0) -> list[dict[str, Any]]:
    """Local hashtags ranked by how many statuses use them (``Tag`` shape).

    Shared by the public ``/api/v1/trends/tags`` endpoint and the admin variant.
    """
    rows = db.execute(
        select(StatusTag.name, func.count().label("uses"))
        .group_by(StatusTag.name)
        .order_by(func.count().desc(), StatusTag.name)
        .offset(clamp_offset(offset))
        .limit(clamp_limit(limit))
    ).all()
    return [serialize_tag(name, config, uses_today=int(uses)) for name, uses in rows]


def trending_status_rows(
    db: DbSession, config: Config, account: Account | None, limit: int, offset: int = 0
) -> list[dict[str, Any]]:
    """The most-favourited public local statuses (serialized).

    Shared by the public ``/api/v1/trends/statuses`` endpoint and the admin variant.
    """
    fav_count = select(func.count()).select_from(Favourite).where(Favourite.status_id == Status.id).scalar_subquery()
    stmt = (
        select(Status)
        .where(Status.visibility.in_(["public", "unlisted"]), Status.reblog_of_id.is_(None))
        .order_by(fav_count.desc(), Status.id.desc())
        .offset(clamp_offset(offset))
        .limit(clamp_limit(limit))
    )
    statuses = db.scalars(stmt).all()
    return serialize_status_list(db, list(statuses), config, account)


@router.get("/api/v1/trends")
@router.get("/api/v1/trends/tags")
def trends_tags(db: DbSession, config: Config, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]:
    """Trending tags, derived from local hashtag usage."""
    return trending_tag_rows(db, config, min(limit, 20), offset)


@router.get("/api/v1/trends/statuses")
def trends_statuses(
    db: DbSession,
    config: Config,
    account: CurrentAccount,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Trending statuses: the most-favourited public local statuses."""
    return trending_status_rows(db, config, account, min(limit, 40), offset)


@router.get("/api/v1/trends/links")
def trends_links() -> list[Any]:
    """Trending links — empty (the mock does not synthesize preview cards)."""
    return []


@router.get("/api/v1/endorsements")
def endorsements(db: DbSession, config: Config, account: CurrentAccount) -> list[dict[str, Any]]:
    """Accounts the viewer has endorsed (``relationships.endorsed``)."""
    if account is None:
        return []
    accounts = db.scalars(
        select(Account)
        .join(Relationship, Relationship.target_account_id == Account.id)
        .where(Relationship.source_account_id == account.id, Relationship.endorsed.is_(True))
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


# `followed_tags`, `tag()`, and tag follow/unfollow live in routers/tags.py.
