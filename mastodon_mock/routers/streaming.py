"""Server-Sent-Events streaming endpoints. See spec/streaming.md.

These hold an open ``text/event-stream`` connection and forward events from the
in-process bus (:mod:`mastodon_mock.streaming`). ``Mastodon.py`` consumes these
via ``stream_user`` / ``stream_public`` / ``stream_hashtag`` / ``stream_list`` /
``stream_direct``.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.datastructures import QueryParams
from starlette.websockets import WebSocketState

from mastodon_mock.db.models import Account, OAuthToken
from mastodon_mock.deps import CurrentAccount, DbSession, RequiredAccount
from mastodon_mock.streaming import (
    EventBus,
    direct_channel,
    get_bus,
    hashtag_channel,
    list_channel,
    sse_format,
    user_channel,
    ws_format,
)

router = APIRouter(tags=["streaming"])


def _require_streaming(request: Request) -> EventBus:
    """Return the bus, or 404 when streaming is disabled (mirrors a real off switch)."""
    bus = get_bus(request.app)
    if bus is None:
        raise HTTPException(status_code=404, detail="Streaming is not enabled")
    return bus


def _heartbeat_seconds(request: Request) -> float:
    """The configured SSE keep-alive cadence."""
    return float(request.app.state.config.streaming.heartbeat_seconds)


async def _stream(request: Request, bus: EventBus, channel: str) -> StreamingResponse:
    """Build a StreamingResponse that drains ``channel`` until the client leaves."""
    heartbeat = _heartbeat_seconds(request)
    sub = bus.subscribe(channel)

    async def gen() -> AsyncIterator[bytes]:
        try:
            # Mastodon sends an initial comment so clients know the stream is live.
            yield b":connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=heartbeat)
                except TimeoutError:
                    yield b":thump\n\n"
                    continue
                yield sse_format(event.name, event.payload)
        finally:
            bus.unsubscribe(sub)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/api/v1/streaming/health")
def streaming_health() -> PlainTextResponse:
    """Liveness probe for ``stream_healthy()``; always OK even if streaming is off."""
    return PlainTextResponse("OK")


@router.get("/api/v1/streaming/user")
async def stream_user(request: Request, account: RequiredAccount) -> StreamingResponse:
    """Home-timeline updates + notifications for the authed account."""
    bus = _require_streaming(request)
    return await _stream(request, bus, user_channel(account.id))


@router.get("/api/v1/streaming/user/notification")
async def stream_user_notification(request: Request, account: RequiredAccount) -> StreamingResponse:
    """Legacy split stream: notifications only, same channel as ``stream_user``."""
    bus = _require_streaming(request)
    return await _stream(request, bus, user_channel(account.id))


@router.get("/api/v1/streaming/public")
async def stream_public(request: Request, viewer: CurrentAccount) -> StreamingResponse:
    """Every public status event."""
    bus = _require_streaming(request)
    return await _stream(request, bus, "public")


@router.get("/api/v1/streaming/public/local")
async def stream_public_local(request: Request, viewer: CurrentAccount) -> StreamingResponse:
    """Public events from local (no-domain) accounts."""
    bus = _require_streaming(request)
    return await _stream(request, bus, "public:local")


@router.get("/api/v1/streaming/public/remote")
async def stream_public_remote(request: Request, viewer: CurrentAccount) -> StreamingResponse:
    """Public events from remote (domained) accounts."""
    bus = _require_streaming(request)
    return await _stream(request, bus, "public:remote")


@router.get("/api/v1/streaming/hashtag")
async def stream_hashtag(request: Request, tag: str, viewer: CurrentAccount) -> StreamingResponse:
    """Public updates for a hashtag."""
    bus = _require_streaming(request)
    return await _stream(request, bus, hashtag_channel(tag))


@router.get("/api/v1/streaming/hashtag/local")
async def stream_hashtag_local(request: Request, tag: str, viewer: CurrentAccount) -> StreamingResponse:
    """Public updates for a hashtag, local accounts only."""
    bus = _require_streaming(request)
    return await _stream(request, bus, hashtag_channel(tag, local=True))


@router.get("/api/v1/streaming/list")
async def stream_list(request: Request, list: str, account: RequiredAccount) -> StreamingResponse:
    """Updates from accounts on the given list (``list`` query param)."""
    bus = _require_streaming(request)
    try:
        list_id = int(list)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid list id") from exc
    return await _stream(request, bus, list_channel(list_id))


@router.get("/api/v1/streaming/direct")
async def stream_direct(request: Request, account: RequiredAccount) -> StreamingResponse:
    """Direct-message conversation events for the authed account."""
    bus = _require_streaming(request)
    return await _stream(request, bus, direct_channel(account.id))


def _account_from_query_token(db: DbSession, request: Request | WebSocket) -> Account | None:
    """Resolve an account from an ``access_token`` query param.

    The legacy single-endpoint streaming API (below) is used by browser/Electron
    clients (e.g. Whalebird) whose native EventSource/WebSocket APIs can't set an
    ``Authorization`` header, so the token travels in the query string instead.
    """
    token_value = request.query_params.get("access_token")
    if not token_value:
        return None
    token = db.scalar(select(OAuthToken).where(OAuthToken.access_token == token_value))
    if token is None or token.account_id is None:
        return None
    return db.get(Account, token.account_id)


def _resolve_legacy_channel(query_params: QueryParams, account: Account | None) -> str:
    """Map the legacy ``?stream=...`` query param (+ resolved account) to a channel key.

    Shared by the SSE (:func:`stream_legacy`) and WebSocket (:func:`stream_ws`)
    endpoints, which differ only in transport, not in which events they deliver.
    """
    stream = query_params.get("stream")
    if stream == "user":
        if account is None:
            raise HTTPException(status_code=401, detail="The access token is invalid")
        return user_channel(account.id)
    if stream == "public":
        return "public"
    if stream == "public:local":
        return "public:local"
    if stream == "public:remote":
        return "public:remote"
    if stream == "hashtag":
        return hashtag_channel(query_params.get("tag", ""))
    if stream == "hashtag:local":
        return hashtag_channel(query_params.get("tag", ""), local=True)
    if stream == "list":
        if account is None:
            raise HTTPException(status_code=401, detail="The access token is invalid")
        try:
            list_id = int(query_params.get("list", ""))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid list id") from exc
        return list_channel(list_id)
    if stream == "direct":
        if account is None:
            raise HTTPException(status_code=401, detail="The access token is invalid")
        return direct_channel(account.id)
    raise HTTPException(status_code=400, detail="Unknown stream type")


@router.get("/api/v1/streaming")
async def stream_legacy(request: Request, db: DbSession) -> StreamingResponse:
    """Legacy single-endpoint streaming API: ``?stream=<channel>&access_token=...``.

    SSE transport for clients that call the older multiplexed shape instead of
    ``/api/v1/streaming/<channel>`` over plain HTTP. See :func:`stream_ws` for the
    WebSocket transport of the same multiplexed API.
    """
    bus = _require_streaming(request)
    account = _account_from_query_token(db, request)
    channel = _resolve_legacy_channel(request.query_params, account)
    return await _stream(request, bus, channel)


@router.websocket("/api/v1/streaming")
async def stream_ws(websocket: WebSocket) -> None:
    """WebSocket transport of the legacy multiplexed streaming API.

    Real Mastodon (and browser/Electron clients like Whalebird) speak this over a
    WebSocket rather than SSE. Frames use real Mastodon's wire format (see
    :func:`mastodon_mock.streaming.ws_format`) so a client that understands the real
    protocol works unmodified against the mock.

    ``DbSession`` (``deps.get_db``) depends on a ``Request``, which FastAPI does not
    inject for websocket routes, so the session is opened/closed by hand here instead.
    """
    bus = get_bus(websocket.app)
    if bus is None:
        await websocket.close(code=1008)
        return

    session_factory: sessionmaker[Session] = websocket.app.state.session_factory
    db = session_factory()
    try:
        account = _account_from_query_token(db, websocket)
        channel = _resolve_legacy_channel(websocket.query_params, account)
    except HTTPException as exc:
        await websocket.close(code=1008, reason=str(exc.detail))
        return
    finally:
        db.close()

    await websocket.accept()
    heartbeat = float(websocket.app.state.config.streaming.heartbeat_seconds)
    sub = bus.subscribe(channel)
    stream_name = websocket.query_params.get("stream", channel)
    try:
        while True:
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            try:
                event = await asyncio.wait_for(sub.queue.get(), timeout=heartbeat)
            except TimeoutError:
                continue  # WS has its own ping/pong keep-alive; no text heartbeat needed
            await websocket.send_text(ws_format(stream_name, event.name, event.payload))
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(sub)
        with contextlib.suppress(RuntimeError):
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
