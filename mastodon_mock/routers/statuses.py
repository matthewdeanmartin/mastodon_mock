"""Statuses endpoints (read + write). The highest-priority router.

See spec/03-api-coverage.md "statuses (write)".
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select

from mastodon_mock.db.models import (
    Account,
    Bookmark,
    Favourite,
    Idempotency,
    MediaAttachment,
    Pin,
    Poll,
    PollOption,
    ScheduledStatus,
    Status,
    StatusMute,
    utcnow,
)
from mastodon_mock.deps import Config, CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.pagination import paginate
from mastodon_mock.routers.helpers import PageQuery, array_query, set_link_header
from mastodon_mock.serializers.accounts import serialize_account
from mastodon_mock.serializers.common import iso
from mastodon_mock.serializers.instance import MAX_MEDIA_ATTACHMENTS, MAX_STATUS_CHARACTERS
from mastodon_mock.serializers.misc import serialize_scheduled_status
from mastodon_mock.serializers.statuses import (
    serialize_status,
    serialize_status_edit,
    serialize_status_source,
)
from mastodon_mock.services import add_notification, attach_mentions_and_tags

router = APIRouter()

# Mastodon publishes immediately (rather than scheduling) when scheduled_at is
# within this window of "now". Match its documented ~5 minute minimum lead time.
SCHEDULE_THRESHOLD = timedelta(minutes=5)


def _validation_error(message: str) -> JSONResponse:
    """A Mastodon-shaped 422 (``{"error": ...}``), what Mastodon.py expects."""
    return JSONResponse(status_code=422, content={"error": message})


def _validate_status_params(params: dict[str, Any]) -> JSONResponse | None:
    """Reject posts a real Mastodon would 422, returning the error response.

    Mirrors the server-side checks Mastodon.py callers rely on:

    * a status with no text *and* no media/poll is empty → rejected;
    * text longer than ``max_characters`` (the value advertised on
      ``/api/v1/instance``) is rejected;
    * more than ``max_media_attachments`` media ids is rejected.

    Returns ``None`` when the post is acceptable.
    """
    text = str(params.get("status") or "")
    media_ids = params.get("media_ids")
    media_count = len(media_ids) if isinstance(media_ids, list) else (1 if media_ids else 0)
    has_poll = isinstance(params.get("poll"), dict)

    if not text.strip() and media_count == 0 and not has_poll:
        return _validation_error("Validation failed: Text can't be blank")
    if len(text) > MAX_STATUS_CHARACTERS:
        return _validation_error(f"Validation failed: Text is too long (maximum is {MAX_STATUS_CHARACTERS} characters)")
    if media_count > MAX_MEDIA_ATTACHMENTS:
        return _validation_error(
            f"Validation failed: Media attachments count is too high " f"(maximum is {MAX_MEDIA_ATTACHMENTS})"
        )
    return None


def _get_status_or_404(db: DbSession, status_id: str) -> Status:
    """Fetch a status by id or raise 404."""
    try:
        status = db.get(Status, int(status_id))
    except (ValueError, TypeError):
        status = None
    if status is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return status


def _require_status_owner(status: Status, account: Account) -> None:
    """Raise 403 unless ``account`` owns ``status``."""
    if status.account_id != account.id:
        raise HTTPException(status_code=403, detail="This action is not allowed")


async def _form_or_json(request: Request) -> dict[str, Any]:
    """Read params from either JSON body or form-encoded body."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            return dict(await request.json())
        except Exception:
            return {}
    form = await request.form()
    out: dict[str, Any] = {}
    for key in form:
        values = form.getlist(key)
        if key.endswith("[]"):
            # Array-style key (e.g. ``media_ids[]``) → list under the bare name.
            out[key[:-2]] = list(values)
        else:
            out[key] = values if len(values) > 1 else values[0]
    return out


# --- Reads ---


@router.get("/api/v1/statuses")
def statuses_many(
    request: Request,
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
) -> list[dict[str, Any]]:
    """Fetch multiple statuses by ``id[]``."""
    out = []
    for raw in array_query(request, "id"):
        try:
            s = db.get(Status, int(raw))
        except (ValueError, TypeError):
            s = None
        if s is not None:
            out.append(serialize_status(db, s, config, viewer))
    return out


@router.get("/api/v1/statuses/{status_id}")
def get_status(status_id: str, db: DbSession, config: Config, viewer: CurrentAccount) -> dict[str, Any]:
    """Fetch a single status."""
    status = _get_status_or_404(db, status_id)
    return serialize_status(db, status, config, viewer)


@router.get("/api/v1/statuses/{status_id}/context")
def status_context(status_id: str, db: DbSession, config: Config, viewer: CurrentAccount) -> dict[str, Any]:
    """Return ancestors (reply chain up) and descendants (replies down)."""
    status = _get_status_or_404(db, status_id)

    ancestors: list[Status] = []
    cur = status
    while cur.in_reply_to_id is not None:
        parent = db.get(Status, cur.in_reply_to_id)
        if parent is None:
            break
        ancestors.append(parent)
        cur = parent
    ancestors.reverse()

    descendants: list[Status] = []
    frontier = [status.id]
    while frontier:
        current_id = frontier.pop(0)
        children = db.scalars(select(Status).where(Status.in_reply_to_id == current_id)).all()
        for child in children:
            descendants.append(child)
            frontier.append(child.id)

    return {
        "ancestors": [serialize_status(db, s, config, viewer) for s in ancestors],
        "descendants": [serialize_status(db, s, config, viewer) for s in descendants],
    }


@router.get("/api/v1/statuses/{status_id}/reblogged_by")
def reblogged_by(status_id: str, db: DbSession, config: Config) -> list[dict[str, Any]]:
    """Accounts that reblogged the status."""
    status = _get_status_or_404(db, status_id)
    accounts = db.scalars(
        select(Account).join(Status, Status.account_id == Account.id).where(Status.reblog_of_id == status.id)
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.get("/api/v1/statuses/{status_id}/favourited_by")
def favourited_by(status_id: str, db: DbSession, config: Config) -> list[dict[str, Any]]:
    """Accounts that favourited the status."""
    status = _get_status_or_404(db, status_id)
    accounts = db.scalars(
        select(Account).join(Favourite, Favourite.account_id == Account.id).where(Favourite.status_id == status.id)
    ).all()
    return [serialize_account(db, a, config) for a in accounts]


@router.get("/api/v1/statuses/{status_id}/history")
def status_history(status_id: str, db: DbSession, config: Config, viewer: CurrentAccount) -> list[dict[str, Any]]:
    """Return edit history (N edits → N+1 entries)."""
    status = _get_status_or_404(db, status_id)
    account_data = serialize_account(db, status.account, config)
    out = [serialize_status_edit(snap, account_data) for snap in (status.edit_history or [])]
    # current state as final entry
    out.append(
        serialize_status_edit(
            {
                "content": status.content,
                "spoiler_text": status.spoiler_text,
                "sensitive": status.sensitive,
                "created_at": iso(status.edited_at or status.created_at),
            },
            account_data,
        )
    )
    return out


@router.get("/api/v1/statuses/{status_id}/source")
def status_source(status_id: str, db: DbSession) -> dict[str, Any]:
    """Return the editable source of a status."""
    status = _get_status_or_404(db, status_id)
    return serialize_status_source(status)


@router.get("/api/v1/statuses/{status_id}/quotes")
def status_quotes(
    status_id: str,
    request: Request,
    response: Response,
    db: DbSession,
    config: Config,
    viewer: CurrentAccount,
    params: PageQuery,
) -> list[dict[str, Any]]:
    """Statuses that quote the given status (Mastodon 4.5+)."""
    status = _get_status_or_404(db, status_id)
    query = select(Status).where(Status.quoted_status_id == status.id)
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
    return [serialize_status(db, s, config, viewer) for s in page.items]


# --- Writes ---


@router.post("/api/v1/statuses")
async def post_status(
    request: Request,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> Any:
    """Create a status (or a scheduled status). The core write path."""
    params = await _form_or_json(request)

    idempotency_key = request.headers.get("Idempotency-Key")
    if idempotency_key:
        existing = db.scalar(
            select(Idempotency).where(Idempotency.account_id == account.id, Idempotency.key == idempotency_key)
        )
        if existing is not None:
            prior = db.get(Status, existing.status_id)
            if prior is not None:
                return serialize_status(db, prior, config, account)

    # Reject what a real Mastodon would 422 (empty text, over-length, too much
    # media) *before* touching the DB — a consuming bot must see the failure
    # rather than a phantom success.
    invalid = _validate_status_params(params)
    if invalid is not None:
        return invalid

    scheduled_at = _parse_dt(params.get("scheduled_at"))
    # Mastodon only *schedules* when scheduled_at is far enough in the future
    # (~5 min). A near/past scheduled_at publishes immediately and returns a Status.
    if scheduled_at is not None and scheduled_at - utcnow() > SCHEDULE_THRESHOLD:
        sched = ScheduledStatus(
            account_id=account.id,
            scheduled_at=scheduled_at,
            params=dict(params.items()),
        )
        db.add(sched)
        db.commit()
        return serialize_scheduled_status(sched)

    status = _create_status_from_params(db, account, params)

    if idempotency_key:
        db.add(Idempotency(account_id=account.id, key=idempotency_key, status_id=status.id))

    db.commit()
    return serialize_status(db, status, config, account)


@router.put("/api/v1/statuses/{status_id}")
async def update_status(
    status_id: str,
    request: Request,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
) -> dict[str, Any]:
    """Edit a status, snapshotting the prior version into history."""
    status = _get_status_or_404(db, status_id)
    _require_status_owner(status, account)
    params = await _form_or_json(request)

    # snapshot current state
    history = list(status.edit_history or [])
    history.append(
        {
            "content": status.content,
            "spoiler_text": status.spoiler_text,
            "sensitive": status.sensitive,
            "created_at": iso(status.edited_at or status.created_at),
        }
    )
    status.edit_history = history

    text = params.get("status")
    if text is not None:
        status.text = str(text)
        status.content = f"<p>{text}</p>"
    if (v := params.get("spoiler_text")) is not None:
        status.spoiler_text = str(v)
    if (v := params.get("sensitive")) is not None:
        status.sensitive = _to_bool(v)
    status.edited_at = utcnow()

    db.commit()
    return serialize_status(db, status, config, account)


@router.delete("/api/v1/statuses/{status_id}")
def delete_status(
    status_id: str,
    db: DbSession,
    config: Config,
    account: RequiredAccount,
    delete_media: bool = False,
) -> dict[str, Any]:
    """Delete a status, returning its serialized (now-deleted) shape."""
    status = _get_status_or_404(db, status_id)
    _require_status_owner(status, account)
    data = serialize_status(db, status, config, account)
    data["text"] = status.text

    if delete_media:
        for m in db.scalars(select(MediaAttachment).where(MediaAttachment.status_id == status.id)).all():
            db.delete(m)

    db.delete(status)
    db.commit()
    return data


@router.post("/api/v1/statuses/{status_id}/reblog")
def reblog(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Boost a status (creates a reblog row + notifies the author)."""
    original = _get_status_or_404(db, status_id)
    existing = db.scalar(select(Status).where(Status.reblog_of_id == original.id, Status.account_id == account.id))
    if existing is not None:
        return serialize_status(db, existing, config, account)

    reblog_row = Status(
        account_id=account.id,
        content="",
        text="",
        visibility="public",
        reblog_of_id=original.id,
        created_at=utcnow(),
        edit_history=[],
    )
    db.add(reblog_row)
    db.flush()
    add_notification(
        db, recipient_id=original.account_id, from_account_id=account.id, type_="reblog", status_id=original.id
    )
    db.commit()
    return serialize_status(db, reblog_row, config, account)


@router.post("/api/v1/statuses/{status_id}/unreblog")
def unreblog(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Undo a boost owned by the authed user."""
    original = _get_status_or_404(db, status_id)
    reblog_row = db.scalar(select(Status).where(Status.reblog_of_id == original.id, Status.account_id == account.id))
    if reblog_row is not None:
        db.delete(reblog_row)
    db.commit()
    return serialize_status(db, original, config, account)


@router.post("/api/v1/statuses/{status_id}/favourite")
def favourite(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Favourite a status (notifies the author)."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Favourite).where(Favourite.account_id == account.id, Favourite.status_id == status.id))
    if exists is None:
        db.add(Favourite(account_id=account.id, status_id=status.id, created_at=utcnow()))
        add_notification(
            db, recipient_id=status.account_id, from_account_id=account.id, type_="favourite", status_id=status.id
        )
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/unfavourite")
def unfavourite(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Un-favourite a status."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Favourite).where(Favourite.account_id == account.id, Favourite.status_id == status.id))
    if exists is not None:
        db.delete(exists)
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/bookmark")
def bookmark(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Bookmark a status."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Bookmark).where(Bookmark.account_id == account.id, Bookmark.status_id == status.id))
    if exists is None:
        db.add(Bookmark(account_id=account.id, status_id=status.id, created_at=utcnow()))
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/unbookmark")
def unbookmark(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Un-bookmark a status."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Bookmark).where(Bookmark.account_id == account.id, Bookmark.status_id == status.id))
    if exists is not None:
        db.delete(exists)
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/pin")
def pin(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Pin a status to the authed user's profile."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Pin).where(Pin.account_id == account.id, Pin.status_id == status.id))
    if exists is None:
        db.add(Pin(account_id=account.id, status_id=status.id, created_at=utcnow()))
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/unpin")
def unpin(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unpin a status."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(Pin).where(Pin.account_id == account.id, Pin.status_id == status.id))
    if exists is not None:
        db.delete(exists)
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/mute")
def mute_status(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Mute a conversation."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(StatusMute).where(StatusMute.account_id == account.id, StatusMute.status_id == status.id))
    if exists is None:
        db.add(StatusMute(account_id=account.id, status_id=status.id))
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/unmute")
def unmute_status(status_id: str, db: DbSession, config: Config, account: RequiredAccount) -> dict[str, Any]:
    """Unmute a conversation."""
    status = _get_status_or_404(db, status_id)
    exists = db.scalar(select(StatusMute).where(StatusMute.account_id == account.id, StatusMute.status_id == status.id))
    if exists is not None:
        db.delete(exists)
    db.commit()
    return serialize_status(db, status, config, account)


@router.post("/api/v1/statuses/{status_id}/translate")
def translate(status_id: str, db: DbSession) -> dict[str, Any]:
    """Static: echo content as the "translation"."""
    status = _get_status_or_404(db, status_id)
    return {
        "content": status.content,
        "spoiler_text": status.spoiler_text,
        "detected_source_language": "en",
        "provider": "mastodon_mock",
        "media_attachments": [],
        "poll": None,
    }


# --- Scheduled statuses ---


@router.get("/api/v1/scheduled_statuses")
def list_scheduled(db: DbSession, account: RequiredAccount) -> list[dict[str, Any]]:
    """List the authed user's scheduled statuses (publishing any now due)."""
    _publish_due_scheduled(db, account)
    rows = db.scalars(
        select(ScheduledStatus).where(ScheduledStatus.account_id == account.id).order_by(ScheduledStatus.id)
    ).all()
    return [serialize_scheduled_status(s) for s in rows]


@router.get("/api/v1/scheduled_statuses/{scheduled_id}")
def get_scheduled(scheduled_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Fetch one scheduled status."""
    sched = _get_scheduled_or_404(db, scheduled_id)
    return serialize_scheduled_status(sched)


@router.put("/api/v1/scheduled_statuses/{scheduled_id}")
async def update_scheduled(
    scheduled_id: str, request: Request, db: DbSession, account: RequiredAccount
) -> dict[str, Any]:
    """Reschedule a scheduled status."""
    sched = _get_scheduled_or_404(db, scheduled_id)
    params = await _form_or_json(request)
    new_at = _parse_dt(params.get("scheduled_at"))
    if new_at is not None:
        sched.scheduled_at = new_at
    db.commit()
    return serialize_scheduled_status(sched)


@router.delete("/api/v1/scheduled_statuses/{scheduled_id}", status_code=200)
def delete_scheduled(scheduled_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a scheduled status."""
    sched = _get_scheduled_or_404(db, scheduled_id)
    db.delete(sched)
    db.commit()
    return {}


# --- helpers ---


def _create_status_from_params(db: DbSession, account: Account, params: dict[str, Any]) -> Status:
    """Create a real status row from post params (shared by immediate + scheduled publish).

    Wires reply targets, media, poll, and mention/tag notifications. The caller is
    responsible for committing and for idempotency bookkeeping.
    """
    text = str(params.get("status") or "")
    visibility = str(params.get("visibility") or account.default_privacy or "public")
    in_reply_to_id = _to_int(params.get("in_reply_to_id"))
    in_reply_to_account_id = None
    if in_reply_to_id is not None:
        parent = db.get(Status, in_reply_to_id)
        if parent is not None:
            in_reply_to_account_id = parent.account_id

    # Standard Mastodon 4.5+ uses ``quoted_status_id``; accept ``quote_id`` too
    # (the fedibird extension Mastodon.py also sends). Only set if it resolves.
    quoted_status_id = _to_int(params.get("quoted_status_id") or params.get("quote_id"))
    if quoted_status_id is not None and db.get(Status, quoted_status_id) is None:
        quoted_status_id = None

    status = Status(
        account_id=account.id,
        content=f"<p>{text}</p>",
        text=text,
        visibility=visibility,
        sensitive=_to_bool(params.get("sensitive")),
        spoiler_text=str(params.get("spoiler_text") or ""),
        language=params.get("language"),
        in_reply_to_id=in_reply_to_id,
        in_reply_to_account_id=in_reply_to_account_id,
        quoted_status_id=quoted_status_id,
        application_id=None,
        created_at=utcnow(),
        edit_history=[],
    )
    db.add(status)
    db.flush()

    _attach_media(db, status, params.get("media_ids"))

    poll_params = params.get("poll")
    if isinstance(poll_params, dict):
        _create_poll(db, status, poll_params)

    mentioned = attach_mentions_and_tags(db, status.id, account.id, text)
    for m in mentioned:
        add_notification(db, recipient_id=m.id, from_account_id=account.id, type_="mention", status_id=status.id)

    return status


def _publish_due_scheduled(db: DbSession, account: Account) -> None:
    """Lazily convert any of ``account``'s scheduled statuses whose time has passed.

    Mastodon has a background worker that publishes scheduled statuses; the mock
    has no time driver, so we publish them on read instead. Each due row becomes a
    real status and is removed from the scheduled list.
    """
    now = utcnow()
    due = db.scalars(
        select(ScheduledStatus).where(ScheduledStatus.account_id == account.id, ScheduledStatus.scheduled_at <= now)
    ).all()
    if not due:
        return
    for sched in due:
        _create_status_from_params(db, account, dict(sched.params or {}))
        db.delete(sched)
    db.commit()


def _get_scheduled_or_404(db: DbSession, scheduled_id: str) -> ScheduledStatus:
    """Fetch a scheduled status or raise 404."""
    try:
        sched = db.get(ScheduledStatus, int(scheduled_id))
    except (ValueError, TypeError):
        sched = None
    if sched is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return sched


def _attach_media(db: DbSession, status: Status, media_ids: Any) -> None:
    """Attach previously-uploaded media to a status."""
    if not media_ids:
        return
    if not isinstance(media_ids, (list, tuple)):
        media_ids = [media_ids]
    for raw in media_ids:
        mid = _to_int(raw)
        if mid is None:
            continue
        media = db.get(MediaAttachment, mid)
        if media is not None:
            media.status_id = status.id


def _create_poll(db: DbSession, status: Status, poll_params: dict[str, Any]) -> None:
    """Create a poll + options for a status."""
    options = poll_params.get("options") or []
    if not options:
        return
    expires_in = poll_params.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = utcnow() + timedelta(seconds=int(expires_in))
    poll = Poll(
        status_id=status.id,
        expires_at=expires_at,
        multiple=_to_bool(poll_params.get("multiple")),
        hide_totals=_to_bool(poll_params.get("hide_totals")),
    )
    db.add(poll)
    db.flush()
    for idx, title in enumerate(options):
        db.add(PollOption(poll_id=poll.id, position=idx, title=str(title)))
    status.poll_id = poll.id


def _to_int(value: Any) -> int | None:
    """Best-effort int coercion."""
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _to_bool(value: Any) -> bool:
    """Best-effort bool coercion from form strings."""
    if isinstance(value, bool):
        return value
    return str(value).lower() in ("true", "1", "on")


def _parse_dt(value: Any) -> datetime | None:
    """Parse an ISO datetime string."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
