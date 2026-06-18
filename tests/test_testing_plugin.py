"""Contract tests for the shipped ``mastodon_mock.testing`` sugar.

The in-process tests exercise ``MockServer`` and ``mock_mastodon`` directly. The
subprocess test proves the pytest plugin auto-registers via its ``pytest11``
entry point and that its fixtures work in a clean ``pytest`` run.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from mastodon_mock.config import SeedAccount, SeedConfig
from mastodon_mock.testing import DEFAULT_TEST_SEED, MockServer, mock_mastodon


def test_mockserver_lifecycle_and_client() -> None:
    """start/stop are idempotent and client() logs in a seeded account."""
    server = MockServer()
    assert server.started is False
    server.start()
    server.start()  # idempotent
    assert server.started is True
    assert server.base_url.startswith("http://127.0.0.1:")

    alice = server.client("alice")
    assert alice.account_verify_credentials().username == "alice"

    server.stop()
    server.stop()  # idempotent
    assert server.started is False


def test_client_default_picks_first_tokened_account() -> None:
    """client() with no args logs in as the first seeded account with a token."""
    with MockServer() as server:
        assert server.client().account_verify_credentials().username == "alice"


def test_client_explicit_token() -> None:
    """client(token=...) uses the raw token verbatim."""
    with MockServer() as server:
        c = server.client(token="bob_token")
        assert c.account_verify_credentials().username == "bob"


def test_client_unknown_username_raises() -> None:
    """A helpful error names the seeded accounts."""
    with MockServer() as server, pytest.raises(LookupError, match="No seeded account named 'nobody'"):
        server.client("nobody")


def test_client_tokenless_username_raises() -> None:
    """A seeded account without a token cannot be logged in as."""
    with MockServer() as server, pytest.raises(LookupError, match="has no access_token"):
        server.client("dave")  # remote, tokenless in DEFAULT_TEST_SEED


def test_config_and_seed_are_mutually_exclusive() -> None:
    """Passing both config and seed is a programming error."""
    from mastodon_mock.config import MastodonMockConfig

    with pytest.raises(ValueError, match="not both"):
        MockServer(config=MastodonMockConfig(), seed=DEFAULT_TEST_SEED)


def test_context_manager_stops_on_exception() -> None:
    """The context manager tears the server down even on error."""
    server = MockServer()
    with pytest.raises(RuntimeError), server:
        assert server.started
        raise RuntimeError("boom")
    assert server.started is False


def test_mock_mastodon_context_manager() -> None:
    """mock_mastodon() as a context manager yields a started server."""
    with mock_mastodon() as server:
        assert server.client("alice").account_verify_credentials().username == "alice"


def test_mock_mastodon_decorator_injects_server() -> None:
    """As a decorator, mock_mastodon injects the server by keyword."""
    captured = {}

    @mock_mastodon()
    def body(mastodon_server: MockServer) -> None:
        captured["url"] = mastodon_server.base_url
        captured["user"] = mastodon_server.client("bob").account_verify_credentials().username

    body()  # type: ignore[call-arg]  # pylint: disable=no-value-for-parameter
    assert captured["url"].startswith("http://127.0.0.1:")
    assert captured["user"] == "bob"


def test_mock_mastodon_decorator_no_inject() -> None:
    """inject=False runs the body in a server without changing the signature."""
    ran = {}

    @mock_mastodon(inject=False)
    def body() -> None:
        ran["ok"] = True

    body()
    assert ran["ok"] is True


def test_custom_seed() -> None:
    """A custom seed is honoured."""
    seed = SeedConfig(accounts=[SeedAccount(username="zed", access_token="zed_token")])
    with MockServer(seed=seed) as server:
        assert server.client("zed").account_verify_credentials().username == "zed"


# --- subprocess: prove the pytest11 plugin auto-registers --------------------

_PLUGIN_TEST = textwrap.dedent("""
    import pytest
    from mastodon_mock.config import SeedAccount, SeedConfig
    from mastodon_mock.testing import MockServer


    def test_server_fixture(mastodon_mock_server):
        assert isinstance(mastodon_mock_server, MockServer)
        assert mastodon_mock_server.client("alice").account_verify_credentials().username == "alice"


    def test_client_fixture(mastodon_mock_client):
        assert mastodon_mock_client.account_verify_credentials().username == "alice"


    def test_reset_fixture_first(mastodon_mock_reset):
        # reset() ran before us, so the timeline starts clean regardless of order.
        alice = mastodon_mock_reset.client("alice")
        assert len(alice.timeline_home()) == 0
        alice.status_post("hello")
        assert len(alice.timeline_home()) == 1


    def test_reset_fixture_second(mastodon_mock_reset):
        # Independently of the other reset test: reset() wiped any prior posts.
        assert len(mastodon_mock_reset.client("alice").timeline_home()) == 0


    CUSTOM = SeedConfig(accounts=[SeedAccount(username="zed", access_token="zed_token")])


    @pytest.mark.mastodon_mock(seed=CUSTOM)
    def test_marker_seed(mastodon_mock_server):
        assert mastodon_mock_server.client("zed").account_verify_credentials().username == "zed"
    """)


@pytest.mark.timeout(120)
def test_plugin_fixtures_work_in_subprocess(tmp_path: Path) -> None:
    """The plugin's fixtures + marker work in a clean subprocess pytest run."""
    test_file = tmp_path / "test_plugin_contract.py"
    test_file.write_text(_PLUGIN_TEST)

    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-q", str(test_file)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"subprocess pytest failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    assert "5 passed" in result.stdout, result.stdout
