"""Test-ergonomics sugar for mastodon_mock.

A zero-boilerplate way to stand up a running mock + logged-in client in tests.

* :class:`MockServer` — the core primitive (threaded uvicorn, free port, teardown).
* :func:`mock_mastodon` — dual-use context manager / decorator.
* :data:`DEFAULT_TEST_SEED` — alice/bob/carol seed used by the defaults.

The pytest fixtures live in ``mastodon_mock.testing.plugin``, auto-registered via
the ``pytest11`` entry point when ``mastodon_mock[test]`` is installed.
"""

from __future__ import annotations

from mastodon_mock.testing.seed import DEFAULT_TEST_SEED
from mastodon_mock.testing.server import MockServer
from mastodon_mock.testing.sugar import mock_mastodon

__all__ = ["DEFAULT_TEST_SEED", "MockServer", "mock_mastodon"]
