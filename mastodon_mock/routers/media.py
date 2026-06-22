"""Media endpoints. Stores bytes and serves them back at ``/media/...``."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from mastodon_mock.db.models import MediaAttachment, utcnow
from mastodon_mock.deps import DbSession, RequiredAccount
from mastodon_mock.pagination import parse_db_id
from mastodon_mock.serializers.media import serialize_media

router = APIRouter(tags=["media"])

_MIME_TO_TYPE = {
    "image": "image",
    "video": "video",
    "audio": "audio",
}


def _infer_type(mime: str | None, filename: str | None) -> str:
    """Infer Mastodon media ``type`` from mime type / filename."""
    if mime:
        major = mime.split("/", 1)[0]
        if mime == "image/gif":
            return "gifv"
        if major in _MIME_TO_TYPE:
            return _MIME_TO_TYPE[major]
    if filename:
        ext = Path(filename).suffix.lower()
        if ext in (".jpg", ".jpeg", ".png", ".webp"):
            return "image"
        if ext == ".gif":
            return "gifv"
        if ext in (".mp4", ".mov", ".webm"):
            return "video"
        if ext in (".mp3", ".ogg", ".wav"):
            return "audio"
    return "unknown"


def _parse_focus(focus: str | None) -> dict[str, Any]:
    """Parse a ``"x,y"`` focus string into media meta."""
    if not focus:
        return {}
    try:
        x_str, y_str = focus.split(",")
        return {"focus": {"x": float(x_str), "y": float(y_str)}}
    except (ValueError, TypeError):
        return {}


@router.post("/api/v2/media", status_code=200)
@router.post("/api/v1/media", status_code=200)
async def media_post(
    request: Request,
    db: DbSession,
    account: RequiredAccount,
    file: UploadFile,
    description: Annotated[str | None, Form()] = None,
    focus: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Store an uploaded media file and return a ``MediaAttachment``."""
    media_dir = Path(request.app.state.media_path) / "attachments"
    media_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix or ".bin"
    stored_name = f"{uuid.uuid4().hex}{ext}"
    try:
        (media_dir / stored_name).write_bytes(await file.read())
    finally:
        await file.close()

    base = f"{request.url.scheme}://{request.url.netloc}"
    url = f"{base}/media/attachments/{stored_name}"

    media = MediaAttachment(
        account_id=account.id,
        type=_infer_type(file.content_type, file.filename),
        url=url,
        preview_url=url,
        description=description,
        blurhash="U00000fQfQfQfQfQfQfQfQfQfQfQ",
        meta=_parse_focus(focus),
        filename=stored_name,
        created_at=utcnow(),
    )
    db.add(media)
    db.commit()
    return serialize_media(media)


@router.get("/api/v1/media/{media_id}")
def get_media(media_id: str, db: DbSession) -> dict[str, Any]:
    """Fetch a media attachment."""
    media = _media_or_404(db, media_id)
    return serialize_media(media)


@router.put("/api/v1/media/{media_id}")
async def media_update(media_id: str, request: Request, db: DbSession) -> dict[str, Any]:
    """Update media metadata (description / focus)."""
    media = _media_or_404(db, media_id)
    form: dict[str, Any] = {}
    try:
        form = dict((await request.form()).items())
    except Exception:
        form = {}
    if (desc := form.get("description")) is not None:
        media.description = str(desc)
    if (focus := form.get("focus")) is not None:
        meta = dict(media.meta or {})
        meta.update(_parse_focus(str(focus)))
        media.meta = meta
    db.commit()
    return serialize_media(media)


@router.delete("/api/v1/media/{media_id}", status_code=200)
def media_delete(media_id: str, db: DbSession, account: RequiredAccount) -> dict[str, Any]:
    """Delete a media attachment not yet attached to a status."""
    del account
    media = _media_or_404(db, media_id)
    db.delete(media)
    db.commit()
    return {}


def _media_or_404(db: Session, media_id: str) -> MediaAttachment:
    """Fetch a media attachment or raise 404."""
    pid = parse_db_id(media_id)
    media = db.get(MediaAttachment, pid) if pid is not None else None
    if media is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return media
