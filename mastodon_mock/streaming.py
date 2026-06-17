"""In-process event bus + SSE plumbing for the streaming API.

See spec/streaming.md. ``Mastodon.py`` streams over HTTP Server-Sent-Events, not
WebSocket, so this hosts an SSE stream inside the existing FastAPI app.

The write paths (statuses post/edit/delete, notification side effects) call
:func:`publish` with an already-serialized entity and the set of channels it
belongs to. Each open stream holds a subscription and forwards matching events.

Routes run in a threadpool (they are sync ``def`` handlers), so :func:`publish`
is thread-safe: it hands each event to the event loop via
``loop.call_soon_threadsafe`` so it lands in the right per-subscriber
``asyncio.Queue``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI


@dataclass
class Event:
    """One streaming event: an SSE ``event:`` name + JSON-serializable payload.

    ``channels`` is the set of logical channel keys this event belongs to (e.g.
    ``{"public", "user:3", "hashtag:cats"}``); a subscriber receives the event if
    its own channel key is in this set.
    """

    name: str
    payload: Any
    channels: frozenset[str]


@dataclass(eq=False)
class Subscriber:
    """A single open SSE connection's mailbox, bound to one channel key.

    ``eq=False`` keeps the default identity hash so instances are usable in a set
    (the per-subscriber queue makes value-equality meaningless anyway).
    """

    channel: str
    queue: asyncio.Queue[Event] = field(default_factory=lambda: asyncio.Queue(maxsize=1000))


class EventBus:
    """Synchronous-publish / async-consume fan-out bus, one per app.

    Publishers may be on worker threads; subscribers live on the event loop. The
    loop reference is captured lazily on first subscribe (which always happens on
    the loop) so cross-thread delivery is safe.
    """

    def __init__(self, *, queue_maxsize: int = 1000) -> None:
        self._subscribers: set[Subscriber] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue_maxsize = queue_maxsize

    def subscribe(self, channel: str) -> Subscriber:
        """Register (on the event loop) a subscriber for ``channel``."""
        self._loop = asyncio.get_running_loop()
        sub = Subscriber(channel=channel, queue=asyncio.Queue(maxsize=self._queue_maxsize))
        self._subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        """Drop a subscriber (idempotent)."""
        self._subscribers.discard(sub)

    def publish(self, event: Event) -> None:
        """Fan ``event`` out to every matching subscriber, thread-safely.

        A no-op if no event loop has been bound yet (nothing is listening). If a
        subscriber's queue is full (a stalled client) the oldest event is dropped
        to make room, matching the spec's bounded-buffer behaviour.
        """
        loop = self._loop
        if loop is None or not self._subscribers:
            return
        for sub in tuple(self._subscribers):
            if sub.channel in event.channels:
                loop.call_soon_threadsafe(self._deliver, sub, event)

    @staticmethod
    def _deliver(sub: Subscriber, event: Event) -> None:
        """Enqueue on the loop thread, dropping the oldest event if full."""
        try:
            sub.queue.put_nowait(event)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):  # pragma: no cover - race only
                sub.queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):  # pragma: no cover - race only
                sub.queue.put_nowait(event)


def get_bus(app: FastAPI) -> EventBus | None:
    """Return the app's event bus, or ``None`` when streaming is disabled."""
    return getattr(app.state, "event_bus", None)


def publish(app: FastAPI, name: str, payload: Any, channels: set[str]) -> None:
    """Convenience: build and publish an :class:`Event` if a bus exists."""
    bus = get_bus(app)
    if bus is not None:
        bus.publish(Event(name=name, payload=payload, channels=frozenset(channels)))


def sse_format(name: str, payload: Any) -> bytes:
    """Encode an event as an SSE record Mastodon.py can parse.

    A ``delete`` payload is a bare id string; everything else is compact JSON.
    """
    data = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    return f"event: {name}\ndata: {data}\n\n".encode()


# --- channel-key helpers (keep naming in one place) ---


def user_channel(account_id: int) -> str:
    """The per-account home/notification channel key."""
    return f"user:{account_id}"


def list_channel(list_id: int) -> str:
    """The per-list channel key."""
    return f"list:{list_id}"


def hashtag_channel(tag: str, *, local: bool = False) -> str:
    """The per-hashtag channel key (tags are lowercased)."""
    prefix = "hashtag:local:" if local else "hashtag:"
    return prefix + tag.lower()


def direct_channel(account_id: int) -> str:
    """The per-account direct-conversation channel key."""
    return f"direct:{account_id}"
