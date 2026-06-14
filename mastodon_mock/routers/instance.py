"""Instance metadata endpoints. See spec/03-api-coverage.md + 05-versioning.md."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from mastodon_mock.db.models import Account
from mastodon_mock.deps import Config, DbSession
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.instance import (
    serialize_instance_v1,
    serialize_instance_v2,
    serialize_nodeinfo,
)

router = APIRouter()


@router.get("/api/v1/instance")
@router.get("/api/v1/instance/")
def instance_v1(db: DbSession, config: Config) -> dict[str, Any]:
    """Return v1 instance info."""
    return serialize_instance_v1(db, config)


@router.get("/api/v2/instance")
@router.get("/api/v2/instance/")
def instance_v2(db: DbSession, config: Config) -> dict[str, Any]:
    """Return v2 instance info."""
    return serialize_instance_v2(db, config)


@router.get("/api/v1/instance/activity")
def instance_activity() -> list[Any]:
    """Stub: empty activity list."""
    return []


@router.get("/api/v1/instance/peers")
def instance_peers() -> list[Any]:
    """Stub: empty peer list."""
    return []


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
def instance_terms_of_service() -> dict[str, Any]:
    """Stub: 404 (no ToS configured)."""
    raise HTTPException(status_code=404, detail="Not found")


@router.get("/api/v1/directory")
def instance_directory(
    db: DbSession,
    config: Config,
    offset: int = 0,
    limit: int = 40,
    order: str = "active",
    local: bool = False,
) -> list[dict[str, Any]]:
    """List accounts in the profile directory."""
    query = db.query(Account)
    if local:
        query = query.filter(Account.domain.is_(None))
    query = query.order_by(Account.created_at.desc()).offset(offset).limit(min(limit, 80))
    return [serialize_account(db, acc, config) for acc in query.all()]


@router.get("/api/v1/custom_emojis")
def custom_emojis() -> list[Any]:
    """Stub: empty custom emoji list."""
    return []


@router.get("/api/v1/announcements")
def announcements() -> list[Any]:
    """Stub: empty announcements list."""
    return []


@router.get("/api/v1/instance/extended_description")
def instance_extended_description() -> dict[str, Any]:
    """Static placeholder extended description."""
    return {"updated_at": None, "content": ""}


@router.get("/api/v1/instance/translation_languages")
def instance_translation_languages() -> dict[str, Any]:
    """Stub: empty translation language map."""
    return {}


@router.get("/api/v1/instance/domain_blocks")
def instance_domain_blocks() -> list[Any]:
    """Stub: empty domain block list."""
    return []


@router.get("/api/v1/instance/languages")
def instance_languages() -> list[str]:
    """Static: English only."""
    return ["en"]


# --- Stubs for OOS-but-touched modules (suggestions/trends/endorsements/tags) ---


@router.get("/api/v1/suggestions")
@router.get("/api/v2/suggestions")
def suggestions() -> list[Any]:
    """Stub: empty follow suggestions."""
    return []


@router.get("/api/v1/trends")
@router.get("/api/v1/trends/tags")
def trends_tags() -> list[Any]:
    """Stub: empty trending tags."""
    return []


@router.get("/api/v1/trends/statuses")
def trends_statuses() -> list[Any]:
    """Stub: empty trending statuses."""
    return []


@router.get("/api/v1/trends/links")
def trends_links() -> list[Any]:
    """Stub: empty trending links."""
    return []


@router.get("/api/v1/endorsements")
def endorsements() -> list[Any]:
    """Stub: empty endorsements list."""
    return []


@router.get("/api/v1/followed_tags")
def followed_tags() -> list[Any]:
    """Stub: empty followed tags."""
    return []
