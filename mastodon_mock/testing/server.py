"""The ``MockServer`` primitive: a threaded uvicorn server handle.

Owns free-port allocation, readiness polling, and guaranteed teardown — the
boilerplate every consuming test suite used to copy. All three entry styles
(fixtures, context manager, decorator) funnel through this class.

``uvicorn`` and ``mastodon`` are imported lazily so that importing this module
costs nothing for users who only run the server.
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from types import TracebackType
from typing import TYPE_CHECKING, Any

from mastodon_mock.config import (
    DatabaseConfig,
    MastodonMockConfig,
    SeedConfig,
)
from mastodon_mock.testing.seed import DEFAULT_TEST_SEED

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def _default_config(seed: SeedConfig | None = None) -> MastodonMockConfig:
    """The built-in default: an in-memory DB seeded with alice/bob/carol."""
    return MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=seed if seed is not None else DEFAULT_TEST_SEED,
    )


class MockServer:
    """A handle to a threaded uvicorn server running a mastodon_mock app.

    Construct, then :meth:`start` (or use as a context manager). ``start``/``stop``
    are idempotent. Free-port allocation, readiness polling and teardown all live
    here, once.
    """

    def __init__(
        self,
        *,
        config: MastodonMockConfig | None = None,
        seed: SeedConfig | None = None,
        host: str = "127.0.0.1",
        startup_timeout: float = 10.0,
        shutdown_timeout: float = 5.0,
        log_level: str = "warning",
    ) -> None:
        """Configure (but do not start) a mock server.

        Args:
            config: A full config. Mutually exclusive with ``seed``.
            seed: A seed to drop into the default in-memory config. Ignored if
                ``config`` is given.
            host: Interface to bind. Defaults to loopback.
            startup_timeout: Seconds to wait for readiness before raising.
            shutdown_timeout: Seconds to wait for the thread to join on stop.
            log_level: uvicorn log level.

        Raises:
            ValueError: If both ``config`` and ``seed`` are supplied.
        """
        if config is not None and seed is not None:
            raise ValueError("Pass either `config` or `seed`, not both.")
        self._config = config if config is not None else _default_config(seed)
        self._host = host
        self._startup_timeout = startup_timeout
        self._shutdown_timeout = shutdown_timeout
        self._log_level = log_level

        self._server: Any = None
        self._thread: threading.Thread | None = None
        self._port: int | None = None

    # --- lifecycle --------------------------------------------------------

    @property
    def started(self) -> bool:
        """Whether the server is currently running."""
        return self._server is not None and self._port is not None

    def start(self) -> MockServer:
        """Bind a free port, launch uvicorn in a thread, wait for readiness.

        Idempotent: a no-op if already started. Returns ``self`` for chaining.

        Raises:
            TimeoutError: If the server does not report readiness in time.
        """
        if self.started:
            return self

        import uvicorn  # lazy: keep import cost off server-only users

        from mastodon_mock.app import create_app

        app = create_app(self._config)
        # port=0 lets the OS assign a free port; we read it back from the bound
        # socket after startup, avoiding the bind-close-rebind TOCTOU race.
        server = uvicorn.Server(uvicorn.Config(app, host=self._host, port=0, log_level=self._log_level))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()

        deadline = time.time() + self._startup_timeout
        while not server.started and time.time() < deadline:
            if not thread.is_alive():
                raise RuntimeError("mock server thread exited before startup completed")
            time.sleep(0.02)

        if not server.started:
            server.should_exit = True
            thread.join(timeout=self._shutdown_timeout)
            raise TimeoutError(f"mock server did not start within {self._startup_timeout:g}s")

        self._port = _read_back_port(server, self._host)
        self._server = server
        self._thread = thread
        return self

    def stop(self) -> None:
        """Signal the server to exit and join its thread. Idempotent."""
        if self._server is None:
            return
        self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=self._shutdown_timeout)
            if self._thread.is_alive():
                logger.warning(
                    "mock server thread did not join within %gs; relying on daemon backstop",
                    self._shutdown_timeout,
                )
        self._server = None
        self._thread = None
        self._port = None

    # --- context manager --------------------------------------------------

    def __enter__(self) -> MockServer:
        """Start the server on entry."""
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        """Stop the server on exit, even on exception."""
        self.stop()

    # --- accessors --------------------------------------------------------

    @property
    def config(self) -> MastodonMockConfig:
        """The config the server was built with."""
        return self._config

    @property
    def port(self) -> int:
        """The bound port.

        Raises:
            RuntimeError: If the server is not started.
        """
        if self._port is None:
            raise RuntimeError("MockServer is not started; call start() first")
        return self._port

    @property
    def base_url(self) -> str:
        """The server's base URL, e.g. ``http://127.0.0.1:54321``."""
        return f"http://{self._host}:{self.port}"

    # --- helpers ----------------------------------------------------------

    def client(self, username: str | None = None, *, token: str | None = None) -> Any:
        """Return a ``Mastodon`` client pointed at this server.

        Args:
            username: A seeded account whose ``access_token`` is looked up. Defaults
                to the first seeded account with a token.
            token: An explicit raw access token. Mutually exclusive with ``username``.

        Returns:
            A logged-in ``Mastodon`` client.

        Raises:
            ValueError: If both ``username`` and ``token`` are supplied.
            LookupError: If the username isn't seeded or has no token, or if no
                seeded account has a token when defaulting.
        """
        from mastodon.Mastodon import Mastodon as MastodonClient  # lazy

        if username is not None and token is not None:
            raise ValueError("Pass either `username` or `token`, not both.")

        resolved = token if token is not None else self._resolve_token(username)
        return MastodonClient(access_token=resolved, api_base_url=self.base_url)

    def _resolve_token(self, username: str | None) -> str:
        """Resolve a seeded username (or the default account) to its token."""
        accounts = self._config.seed.accounts
        if username is None:
            for account in accounts:
                if account.access_token:
                    return account.access_token
            raise LookupError("No seeded account has an access_token to log in with.")

        for account in accounts:
            if account.username == username:
                if not account.access_token:
                    raise LookupError(f"Seeded account {username!r} has no access_token; it cannot be logged in as.")
                return account.access_token
        seeded = ", ".join(a.username for a in accounts) or "<none>"
        raise LookupError(f"No seeded account named {username!r}. Seeded: {seeded}.")

    def reset(self) -> None:
        """Reset the server to seed state via ``POST /api/v1/_mock/reset``."""
        import httpx2 as httpx  # lazy; httpx2 is the maintained successor

        resp = httpx.post(f"{self.base_url}/api/v1/_mock/reset")
        resp.raise_for_status()

    # --- streaming & faults (see spec/streaming.md, spec/fault_injection.md) ----

    def stream(
        self,
        channel: str,
        *,
        username: str | None = None,
        token: str | None = None,
        tag: str | None = None,
        list_id: int | str | None = None,
    ) -> StreamCollector:
        """Open an SSE stream and collect parsed events. Use as a context manager.

        Args:
            channel: One of ``user``, ``public``, ``public:local``, ``public:remote``,
                ``hashtag``, ``list``, ``direct``.
            username/token: Auth for channels that require it (``user``/``list``/``direct``).
            tag: Hashtag (without ``#``) for the ``hashtag`` channel.
            list_id: List id for the ``list`` channel.

        Returns:
            A :class:`StreamCollector`; enter it to start receiving, exit to close.
        """
        client = self.client(username, token=token) if (username or token) else self.client()
        return StreamCollector(client, channel, tag=tag, list_id=list_id)

    def fault(
        self,
        *,
        path: str | None = None,
        path_regex: str | None = None,
        methods: list[str] | None = None,
        type: str = "status",
        status: int | None = None,
        body: Any = None,
        headers: dict[str, str] | None = None,
        delay_ms: int = 0,
        truncate: bool = True,
        count: int | None = None,
    ) -> FaultHandle:
        """Register a fault-injection rule. Use as a context manager to auto-clear.

        Flattened kwargs mirror the JSON body of ``POST /api/v1/_mock/faults`` (see
        spec/fault_injection.md). Returns a :class:`FaultHandle` exposing the rule id.
        """
        effect: dict[str, Any] = {"type": type, "delay_ms": delay_ms, "truncate": truncate}
        if status is not None:
            effect["status"] = status
        if body is not None:
            effect["body"] = body
        if headers is not None:
            effect["headers"] = headers
        rule = {
            "match": {"methods": methods, "path": path, "path_regex": path_regex},
            "effect": effect,
            "count": count,
        }
        return FaultHandle(self.base_url, rule)


class StreamCollector:
    """Collect parsed streaming events from a Mastodon.py async stream.

    Backed by a real ``StreamListener`` running ``run_async=True``, so it exercises
    the same SSE parsing a consuming client would. Enter to connect, exit to close.
    """

    def __init__(
        self,
        client: Any,
        channel: str,
        *,
        tag: str | None = None,
        list_id: int | str | None = None,
    ) -> None:
        self._client = client
        self._channel = channel
        self._tag = tag
        self._list_id = list_id
        self._handle: Any = None
        self._events: list[Any] = []
        self._cond = threading.Condition()
        self._listener = self._make_listener()

    def _make_listener(self) -> Any:
        from mastodon.streaming import StreamListener  # lazy

        collector = self

        class _Listener(StreamListener):
            def on_any_event(self, name: str, data: Any = None, for_stream: Any = None) -> None:
                with collector._cond:
                    collector._events.append(_StreamEvent(name, data))
                    collector._cond.notify_all()

        return _Listener()

    def __enter__(self) -> StreamCollector:
        """Open the stream (async) and start collecting."""
        self._handle = self._connect()
        return self

    def __exit__(self, *exc: object) -> None:
        """Close the stream."""
        if self._handle is not None:
            with contextlib.suppress(Exception):  # pragma: no cover - best-effort teardown
                self._handle.close()
            self._handle = None

    def _connect(self) -> Any:
        c = self._client
        ch = self._channel
        if ch == "user":
            return c.stream_user(self._listener, run_async=True)
        if ch == "public":
            return c.stream_public(self._listener, run_async=True)
        if ch == "public:local":
            return c.stream_public(self._listener, run_async=True, local=True)
        if ch == "public:remote":
            return c.stream_public(self._listener, run_async=True, remote=True)
        if ch == "hashtag":
            return c.stream_hashtag(self._tag, self._listener, run_async=True)
        if ch == "list":
            return c.stream_list(self._list_id, self._listener, run_async=True)
        if ch == "direct":
            return c.stream_direct(self._listener, run_async=True)
        raise ValueError(f"Unknown stream channel {ch!r}")

    def next(self, event_name: str | None = None, *, timeout: float = 5.0) -> Any:
        """Block until the next (matching) event arrives and return its payload.

        Args:
            event_name: If given, skip events whose name differs.
            timeout: Seconds to wait before raising ``TimeoutError``.
        """
        deadline = time.time() + timeout
        seen = 0
        with self._cond:
            while True:
                while seen < len(self._events):
                    evt = self._events[seen]
                    seen += 1
                    if event_name is None or evt.name == event_name:
                        return evt.payload
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise TimeoutError(f"no {event_name or 'event'} within {timeout:g}s")
                self._cond.wait(timeout=remaining)

    def all(self) -> list[Any]:
        """Return every event received so far, in order."""
        with self._cond:
            return list(self._events)


@dataclass
class _StreamEvent:
    """A received streaming event: SSE name + parsed payload."""

    name: str
    payload: Any


class FaultHandle:
    """A registered fault rule; deletes itself on context exit.

    Registers eagerly on construction so ``server.fault(...)`` works without a
    ``with`` block; call :meth:`delete` (or use the context manager) to clear it.
    """

    def __init__(self, base_url: str, rule: dict[str, Any]) -> None:
        import httpx2 as httpx  # lazy

        self._base_url = base_url
        resp = httpx.post(f"{base_url}/api/v1/_mock/faults", json=rule)
        resp.raise_for_status()
        self.id: str = resp.json()["id"]

    def __enter__(self) -> FaultHandle:
        """Return self; the rule is already registered."""
        return self

    def __exit__(self, *exc: object) -> None:
        """Delete the rule."""
        self.delete()

    def delete(self) -> None:
        """Remove this fault rule (idempotent)."""
        import httpx2 as httpx  # lazy

        with contextlib.suppress(Exception):  # pragma: no cover - best-effort teardown
            httpx.delete(f"{self._base_url}/api/v1/_mock/faults/{self.id}")


def _read_back_port(server: Any, host: str) -> int:
    """Read the OS-assigned port back from uvicorn's bound socket."""
    for srv in getattr(server, "servers", None) or []:
        for sock in getattr(srv, "sockets", None) or []:
            try:
                return int(sock.getsockname()[1])
            except (OSError, IndexError):  # pragma: no cover - defensive
                continue
    raise RuntimeError(f"could not determine bound port for mock server on {host}")
