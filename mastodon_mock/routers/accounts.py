"""Accounts endpoints (read + write). See spec/03-api-coverage.md."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import and_, or_, select

from mastodon_mock.db.models import (
    Account,
    Relationship,
    Status,
    StatusMention,
    StatusTag,
    UserList,
    UserListAccount,
    utcnow,
)
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, array_query, set_link_header
from mastodon_mock.routers.tags import featured_tags_for
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.misc import serialize_list
from mastodon_mock.serializers.relationships import serialize_relationship
from mastodon_mock.serializers.statuses import serialize_status_list
from mastodon_mock.services import (
    do_follow,
    do_unfollow,
    find_relationship,
    get_or_create_relationship,
)

router = APIRouter()


def _get_account_or_404(db: DbSession, account_id: str) -> Account:
    """Fetch an account by id or raise 404."""
    try:
        account = db.get(Account, int(account_id))
    except (ValueError, TypeError):
        account = None
    if account is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return account


# --- Reads ---


@router.get("/api/v1/accounts/verify_credentials")
def verify_credentials(account: RequiredAccount, db: DbSession, config: Config) -> dict[str, Any]:
    """Return the authed account with its ``source`` block."""
    return serialize_account(db, account, config, with_source=True)


@router.get("/api/v1/accounts/relationships")
def account_relationships(
    request: Request,
    db: DbSession,
    account: RequiredAccount,
) -> list[dict[str, Any]]:
    """Return relationships from the authed account to each requested account."""
    out = []
    for raw in array_query(request, "id"):
        try:
            target_id = int(raw)
        except (ValueError, TypeError):
            continue
        rel = find_relationship(db, account.id, target_id)
        out.append(serialize_relationship(db, target_id, rel, source_id=account.id))
    return out


@router.get("/api/v1/accounts/search")
def account_search(
    db: DbSession,
    config: Config,
    account: CurrentAccount,
    q: str,
    limit: int = 40,
    following: bool = False,
    resolve: bool = False,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Substring search over username/display_name/acct."""
    return _search_accounts(db, config, q, limit, offset, following, account)


@router.get("/api/v1/accounts/lookup")
def account_lookup(db: DbSession, config: Config, acct: str) -> dict[str, Any]:
    """Exact ``acct`` lookup (no webfinger)."""
    username, _, domain = acct.lstrip("@").partition("@")
    stmt = select(Account).where(Account.username == username)
    stmt = stmt.where(Account.domain == (domain or None))
    found = db.scalar(stmt)
    if found is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return serialize_account(db, found, config)


async def _ids_from_query_or_json(request: Request) -> list[str]:
    """Collect ``id``/``id[]`` ids from the query string or a JSON body.

    ``account_familiar_followers`` is the odd one out: Mastodon.py sends its ids in
    a JSON body (``use_json=True``) on a GET, so query parsing alone misses them.
    """
    ids = array_query(request, "id")
    if ids:
        return ids
    try:
        body = await request.json()
    except Exception:
        return []
    raw_ids = body.get("id") if isinstance(body, dict) else None
    if raw_ids is None:
        return []
    if not isinstance(raw_ids, list):
        raw_ids = [raw_ids]
    return [str(x) for x in raw_ids]


@router.get("/api/v1/accounts/familiar_followers")
async def account_familiar_followers(
    request: Request,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> list[dict[str, Any]]:
    """Return, per requested account, followers shared with the authed user."""
    my_followers = {
        r.source_account_id
        for r in db.scalars(
            select(Relationship).where(Relationship.target_account_id == account.id, Relationship.following.is_(True))
        ).all()
    }
    out = []
    for raw in await _ids_from_query_or_json(request):
        try:
            target_id = int(raw)
        except (ValueError, TypeError):
            continue
        their_followers = {
            r.source_account_id
            for r in db.scalars(
                select(Relationship).where(
                    Relationship.target_account_id == target_id, Relationship.following.is_(True)
                )
            ).all()
        }
        common = my_followers & their_followers
        accounts = [db.get(Account, aid) for aid in common]
        out.append(
            {
                "id": str(target_id),
                "accounts": [serialize_account(db, a, config) for a in accounts if a is not None],
            }
        )
    return out


@router.get("/api/v1/accounts")
def accounts_many(
    request: Request,
    db: DbSession,
    config: Config,
) -> list[dict[str, Any]]:
    """Fetch multiple accounts by ``id[]``."""
    out = []
    for raw in array_query(request, "id"):
        try:
            acc = db.get(Account, int(raw))
        except (ValueError, TypeError):
            acc = None
        if acc is not None:
            out.append(serialize_account(db, acc, config))
    return out


@router.get("/api/v1/accounts/{account_id}")
def get_account(account_id: str, db: DbSession, config: Config) -> dict[str, Any]:
    """Fetch a single account."""
    acc = _get_account_or_404(db, account_id)
    return serialize_account(db, acc, config)


@router.get("/api/v1/accounts/{account_id}/statuses")
def account_statuses(
    account_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    params: PageQuery,
    only_media: bool = False,
    pinned: bool = False,
    exclude_replies: bool = False,
    exclude_reblogs: bool = False,
    tagged: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch an account's statuses with filters + pagination."""
    acc = _get_account_or_404(db, account_id)
    from mastodon_mock.db.models import MediaAttachment, Pin

    query = select(Status).where(Status.account_id == acc.id)
    query = _filter_account_statuses_visible_to(query, viewer)
    if exclude_replies:
        query = query.where(Status.in_reply_to_id.is_(None))
    if exclude_reblogs:
        query = query.where(Status.reblog_of_id.is_(None))
    if only_media:
        query = query.where(
            Status.id.in_(select(MediaAttachment.status_id).where(MediaAttachment.status_id.is_not(None)))
        )
    if pinned:
        query = query.where(Status.id.in_(select(Pin.status_id).where(Pin.account_id == acc.id)))
    if tagged:
        query = query.where(Status.id.in_(select(StatusTag.status_id).where(StatusTag.name == tagged.lower())))

    page = paginate(
        db,
        query,
        Status.id,
        max_id=params.max_id,
        min_id=params.min_id,
        since_id=params.since_id,
        limit=params.limit,
    )
    set_link_header(request, response, page)
    return serialize_status_list(db, list(page.items), config, viewer)


def _filter_account_statuses_visible_to(query: Any, viewer: Account | None) -> Any:
    """Apply Mastodon profile-timeline visibility rules to a status query."""
    public_profile = Status.visibility.in_(("public", "unlisted"))
    if viewer is None:
        return query.where(public_profile)

    followed_accounts = select(Relationship.target_account_id).where(
        Relationship.source_account_id == viewer.id,
        Relationship.following.is_(True),
    )
    mentioned_statuses = select(StatusMention.status_id).where(StatusMention.account_id == viewer.id)
    return query.where(
        or_(
            public_profile,
            Status.account_id == viewer.id,
            and_(Status.visibility == "private", Status.account_id.in_(followed_accounts)),
            and_(Status.visibility == "direct", Status.id.in_(mentioned_statuses)),
        )
    )


@router.get("/api/v1/accounts/{account_id}/following")
def account_following(
    account_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Fetch accounts the given account follows."""
    acc = _get_account_or_404(db, account_id)
    query = (
        select(Account)
        .join(Relationship, Relationship.target_account_id == Account.id)
        .where(Relationship.source_account_id == acc.id, Relationship.following.is_(True))
    )
    page = paginate(
        db, query, Account.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return [serialize_account(db, a, config) for a in page.items]


@router.get("/api/v1/accounts/{account_id}/followers")
def account_followers(
    account_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Fetch accounts that follow the given account."""
    acc = _get_account_or_404(db, account_id)
    query = (
        select(Account)
        .join(Relationship, Relationship.source_account_id == Account.id)
        .where(Relationship.target_account_id == acc.id, Relationship.following.is_(True))
    )
    page = paginate(
        db, query, Account.id, max_id=params.max_id, min_id=params.min_id, since_id=params.since_id, limit=params.limit
    )
    set_link_header(request, response, page)
    return [serialize_account(db, a, config) for a in page.items]


@router.get("/api/v1/accounts/{account_id}/lists")
def account_lists(account_id: str, db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """Lists owned by the authed user that the given account is a member of."""
    acc = _get_account_or_404(db, account_id)
    lists = db.scalars(
        select(UserList)
        .join(UserListAccount, UserListAccount.list_id == UserList.id)
        .where(UserList.account_id == account.id, UserListAccount.account_id == acc.id)
    ).all()
    return [serialize_list(ul) for ul in lists]


@router.get("/api/v1/accounts/{account_id}/featured_tags")
def account_featured_tags(account_id: str, db: DbSession, config: Config) -> list[dict[str, Any]]:
    """Featured tags for the given account (see routers/tags.py for the writes)."""
    target = _get_account_or_404(db, account_id)
    return featured_tags_for(db, config, target)


# --- Writes ---


@router.post("/api/v1/accounts/{account_id}/follow")
def follow(
    account_id: str,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Follow an account (or send a follow request to a locked one)."""
    target = _get_account_or_404(db, account_id)
    rel = do_follow(db, account, target)
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/unfollow")
def unfollow(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Unfollow an account."""
    target = _get_account_or_404(db, account_id)
    rel = do_unfollow(db, account, target)
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/remove_from_followers")
def remove_from_followers(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove the given account from the authed user's followers."""
    target = _get_account_or_404(db, account_id)
    their = find_relationship(db, target.id, account.id)
    if their is not None:
        their.following = False
    mine = get_or_create_relationship(db, account.id, target.id)
    mine.followed_by = False
    db.commit()
    return serialize_relationship(db, target.id, mine, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/block")
def block(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Block an account, clearing any follow edges between the two."""
    target = _get_account_or_404(db, account_id)
    forward = get_or_create_relationship(db, account.id, target.id)
    backward = get_or_create_relationship(db, target.id, account.id)
    forward.blocking = True
    forward.following = False
    forward.requested = False
    forward.followed_by = False
    backward.blocked_by = True
    backward.following = False
    backward.requested = False
    backward.followed_by = False
    db.commit()
    return serialize_relationship(db, target.id, forward, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/unblock")
def unblock(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Unblock an account."""
    target = _get_account_or_404(db, account_id)
    forward = get_or_create_relationship(db, account.id, target.id)
    backward = find_relationship(db, target.id, account.id)
    forward.blocking = False
    if backward is not None:
        backward.blocked_by = False
    db.commit()
    return serialize_relationship(db, target.id, forward, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/mute")
def mute(
    account_id: str,
    db: DbSession,
    account: RequiredAccount,
    notifications: Annotated[bool, Form()] = True,
    duration: Annotated[int, Form()] = 0,
) -> dict[str, Any]:
    """Mute an account, optionally with a timed expiry."""
    from datetime import timedelta

    target = _get_account_or_404(db, account_id)
    rel = get_or_create_relationship(db, account.id, target.id)
    rel.muting = True
    rel.muting_notifications = notifications
    rel.muting_expires_at = (utcnow() + timedelta(seconds=duration)) if duration else None
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/unmute")
def unmute(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Unmute an account."""
    target = _get_account_or_404(db, account_id)
    rel = get_or_create_relationship(db, account.id, target.id)
    rel.muting = False
    rel.muting_expires_at = None
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/pin")
@router.post("/api/v1/accounts/{account_id}/endorse")
def endorse(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Endorse (feature) an account on the authed user's profile."""
    target = _get_account_or_404(db, account_id)
    rel = get_or_create_relationship(db, account.id, target.id)
    rel.endorsed = True
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/unpin")
@router.post("/api/v1/accounts/{account_id}/unendorse")
def unendorse(account_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Remove an endorsement."""
    target = _get_account_or_404(db, account_id)
    rel = get_or_create_relationship(db, account.id, target.id)
    rel.endorsed = False
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.post("/api/v1/accounts/{account_id}/note")
def account_note(
    account_id: str,
    db: DbSession,
    account: RequiredAccount,
    comment: Annotated[str, Form()] = "",
) -> dict[str, Any]:
    """Set a private note about an account."""
    target = _get_account_or_404(db, account_id)
    rel = get_or_create_relationship(db, account.id, target.id)
    rel.note = comment
    db.commit()
    return serialize_relationship(db, target.id, rel, source_id=account.id)


@router.patch("/api/v1/accounts/update_credentials")
async def update_credentials(
    request: Request,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Update the authed account's profile fields and avatar/header."""
    form = await request.form()

    def _get(name: str) -> Any:
        return form.get(name)

    if (v := _get("display_name")) is not None:
        account.display_name = str(v)
    if (v := _get("note")) is not None:
        account.note = str(v)
    if (v := _get("locked")) is not None:
        account.locked = str(v).lower() in ("true", "1", "on")
    if (v := _get("bot")) is not None:
        account.bot = str(v).lower() in ("true", "1", "on")
    if (v := _get("discoverable")) is not None:
        account.discoverable = str(v).lower() in ("true", "1", "on")
    if (v := _get("source[privacy]")) is not None:
        account.default_privacy = str(v)
    if (v := _get("source[sensitive]")) is not None:
        account.default_sensitive = str(v).lower() in ("true", "1", "on")
    if (v := _get("source[language]")) is not None:
        account.default_language = str(v)

    fields = _collect_fields(form)
    if fields is not None:
        account.fields = fields

    await _store_upload(request, form.get("avatar"), account, "avatar")
    await _store_upload(request, form.get("header"), account, "header")

    db.commit()
    return serialize_account(db, account, config, with_source=True)


@router.delete("/api/v1/profile/avatar")
def delete_avatar(db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Clear the authed account's avatar."""
    account.avatar_url = None
    db.commit()
    return serialize_account(db, account, config, with_source=True)


@router.delete("/api/v1/profile/header")
def delete_header(db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Clear the authed account's header."""
    account.header_url = None
    db.commit()
    return serialize_account(db, account, config, with_source=True)


# --- helpers ---


def _search_accounts(
    db: DbSession,
    config: Config,
    q: str,
    limit: int,
    offset: int,
    following: bool,
    viewer: Account | None,
) -> list[dict[str, Any]]:
    """Shared substring account search."""
    term = q.lstrip("@").strip()
    like = f"%{term}%"
    query = select(Account).where(
        or_(
            Account.username.ilike(like),
            Account.display_name.ilike(like),
        )
    )
    if following and viewer is not None:
        query = query.where(
            Account.id.in_(
                select(Relationship.target_account_id).where(
                    Relationship.source_account_id == viewer.id, Relationship.following.is_(True)
                )
            )
        )
    query = query.order_by(Account.id).offset(offset).limit(min(limit, 80))
    return [serialize_account(db, a, config) for a in db.scalars(query).all()]


def _collect_fields(form: Any) -> list[dict[str, Any]] | None:
    """Collect ``fields_attributes[n][name|value]`` form keys, if present."""
    indices: dict[int, dict[str, str]] = {}
    found = False
    for key in form:
        if key.startswith("fields_attributes["):
            found = True
            inner = key[len("fields_attributes[") :]
            idx_str, _, rest = inner.partition("]")
            field = rest.strip("[]")
            try:
                idx = int(idx_str)
            except ValueError:
                continue
            indices.setdefault(idx, {})[field] = str(form.get(key))
    if not found:
        return None
    out = []
    for idx in sorted(indices):
        entry = indices[idx]
        out.append({"name": entry.get("name", ""), "value": entry.get("value", ""), "verified_at": None})
    return out


async def _store_upload(request: Request, upload: Any, account: Account, kind: str) -> None:
    """Persist an uploaded avatar/header and set the corresponding URL."""
    if not isinstance(upload, UploadFile):
        return
    import uuid
    from pathlib import Path

    media_dir = Path(request.app.state.media_path) / "profile"
    media_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(upload.filename or "").suffix or ".png"
    name = f"{kind}_{account.id}_{uuid.uuid4().hex}{ext}"
    dest = media_dir / name
    dest.write_bytes(await upload.read())
    base = f"{request.url.scheme}://{request.url.netloc}"
    url = f"{base}/media/profile/{name}"
    if kind == "avatar":
        account.avatar_url = url
    else:
        account.header_url = url
