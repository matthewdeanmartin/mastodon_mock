"""The ``MockServer`` primitive: a threaded uvicorn server handle.

Owns free-port allocation, readiness polling, and guaranteed teardown — the
boilerplate every consuming test suite used to copy. All three entry styles
(fixtures, context manager, decorator) funnel through this class.

``uvicorn`` and ``mastodon`` are imported lazily so that importing this module
costs nothing for users who only run the server.
"""

from __future__ import annotations

import logging
import threading
import time
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
                    raise LookupError(f"Seeded account {username!r} has no access_token; " "it cannot be logged in as.")
                return account.access_token
        seeded = ", ".join(a.username for a in accounts) or "<none>"
        raise LookupError(f"No seeded account named {username!r}. Seeded: {seeded}.")

    def reset(self) -> None:
        """Reset the server to seed state via ``POST /api/v1/_mock/reset``."""
        import httpx2 as httpx  # lazy; httpx2 is the maintained successor

        resp = httpx.post(f"{self.base_url}/api/v1/_mock/reset")
        resp.raise_for_status()


def _read_back_port(server: Any, host: str) -> int:
    """Read the OS-assigned port back from uvicorn's bound socket."""
    for srv in getattr(server, "servers", None) or []:
        for sock in getattr(srv, "sockets", None) or []:
            try:
                return int(sock.getsockname()[1])
            except (OSError, IndexError):  # pragma: no cover - defensive
                continue
    raise RuntimeError(f"could not determine bound port for mock server on {host}")
