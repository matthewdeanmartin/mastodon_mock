"""``mock_mastodon``: a dual-use context manager / decorator.

Called with no test function it behaves as a context manager (yielding a started
:class:`MockServer`); used to wrap a function it behaves as a decorator that
starts a server around the call. This mirrors moto's ``mock_aws``.
"""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any, TypeVar, cast, overload

from mastodon_mock.config import MastodonMockConfig, SeedConfig
from mastodon_mock.testing.server import MockServer

F = TypeVar("F", bound=Callable[..., Any])


class _MockMastodon:
    """The object returned by :func:`mock_mastodon`.

    Usable three ways:

    * ``with mock_mastodon(...) as server:`` — context manager.
    * ``@mock_mastodon(...)`` on a test function — decorator (injects the server).
    * ``mock_mastodon(test_fn)`` — bare decorator form.
    """

    def __init__(
        self,
        func: Callable[..., Any] | None = None,
        *,
        config: MastodonMockConfig | None = None,
        seed: SeedConfig | None = None,
        inject: bool = True,
        inject_as: str = "mastodon_server",
        **server_kwargs: Any,
    ) -> None:
        self._config = config
        self._seed = seed
        self._inject = inject
        self._inject_as = inject_as
        self._server_kwargs = server_kwargs
        self._cm_server: MockServer | None = None
        self._func = func

    def _new_server(self) -> MockServer:
        return MockServer(config=self._config, seed=self._seed, **self._server_kwargs)

    # --- context manager --------------------------------------------------

    def __enter__(self) -> MockServer:
        """Start a fresh server and return it."""
        self._cm_server = self._new_server().start()
        return self._cm_server

    def __exit__(self, *exc: Any) -> None:
        """Stop the server, even on exception."""
        if self._cm_server is not None:
            self._cm_server.stop()
            self._cm_server = None

    # --- decorator --------------------------------------------------------

    def __call__(self, func: F) -> F:
        """Wrap ``func`` so a started server surrounds each call."""

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with self._new_server() as server:
                if self._inject:
                    kwargs[self._inject_as] = server
                return func(*args, **kwargs)

        return cast(F, wrapper)


@overload
def mock_mastodon(func: F) -> F: ...


@overload
def mock_mastodon(
    func: None = None,
    *,
    config: MastodonMockConfig | None = None,
    seed: SeedConfig | None = None,
    inject: bool = True,
    inject_as: str = "mastodon_server",
    **server_kwargs: Any,
) -> _MockMastodon: ...


def mock_mastodon(
    func: Callable[..., Any] | None = None,
    *,
    config: MastodonMockConfig | None = None,
    seed: SeedConfig | None = None,
    inject: bool = True,
    inject_as: str = "mastodon_server",
    **server_kwargs: Any,
) -> _MockMastodon | Callable[..., Any]:
    """Start a mock Mastodon server as a context manager or decorator.

    As a context manager::

        with mock_mastodon(seed=MY_SEED) as server:
            alice = server.client("alice")

    As a decorator (injects the ``MockServer`` as a keyword argument)::

        @mock_mastodon(seed=MY_SEED)
        def test_thing(mastodon_server):
            ...

    Args:
        func: The wrapped function, when used as a bare ``@mock_mastodon`` decorator.
        config: A full config. Mutually exclusive with ``seed``.
        seed: A seed to drop into the default in-memory config.
        inject: When used as a decorator, whether to inject the server into the
            wrapped call. Set ``False`` for tests that read a module-level URL.
        inject_as: The keyword name to inject the server under.
        **server_kwargs: Forwarded to :class:`MockServer` (e.g. ``startup_timeout``).

    Returns:
        A dual-use handle: a context manager, or a decorated function when ``func``
        is given.
    """
    handle = _MockMastodon(
        func,
        config=config,
        seed=seed,
        inject=inject,
        inject_as=inject_as,
        **server_kwargs,
    )
    if func is not None:
        return handle(func)
    return handle
