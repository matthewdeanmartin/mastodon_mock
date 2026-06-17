"""Server-Sent-Events streaming endpoints. See spec/streaming.md.

These hold an open ``text/event-stream`` connection and forward events from the
in-process bus (:mod:`mastodon_mock.streaming`). ``Mastodon.py`` consumes these
via ``stream_user`` / ``stream_public`` / ``stream_hashtag`` / ``stream_list`` /
``stream_direct``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from mastodon_mock.deps import CurrentAccount, RequiredAccount
from mastodon_mock.streaming import (
    EventBus,
    direct_channel,
    get_bus,
    hashtag_channel,
    list_channel,
    sse_format,
    user_channel,
)

router = APIRouter()


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
