"""Contract tests for the streaming API, SSE and WebSocket (spec/streaming.md).

These drive the mock through real ``Mastodon.py`` streaming calls, so they prove
the wire format, the streaming-base-URL rewrite, and the write-path event routing
all work end to end. Mock-only: a consuming dual suite excludes them, but the
*behaviour* (live updates) matches a real server.
"""

from __future__ import annotations

import pytest

from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, StreamingConfig
from mastodon_mock.testing import MockServer
from mastodon_mock.testing.seed import DEFAULT_TEST_SEED

pytestmark = pytest.mark.mock_only


def test_stream_healthy(mastodon_mock_server: MockServer) -> None:
    """``stream_healthy()`` returns True against the mock."""
    assert mastodon_mock_server.client("alice").stream_healthy() is True


def test_instance_advertises_on_server_streaming_url(mastodon_mock_server: MockServer) -> None:
    """Both instance endpoints advertise the streaming URL as this server's origin,
    using the ``ws``/``wss`` scheme real Mastodon (and browser/Electron clients that
    use it literally with the WebSocket API) uses.

    Mastodon.py's own ``__get_streaming_base()`` translates ``ws``/``wss`` back to
    ``http``/``https`` + the same netloc before connecting (see
    ``Mastodon.py/mastodon/internals.py``), so it still stays on this server —
    advertising a plain ``http``/``https`` URL here was an unnecessary workaround.
    Mastodon.py normalises v1→v2, surfacing the URL at
    ``configuration.urls.streaming``; the raw v1 JSON exposes ``urls.streaming_api``.
    """
    import httpx2 as httpx

    alice = mastodon_mock_server.client("alice")
    base = mastodon_mock_server.base_url
    expected_ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    assert alice.instance_v2()["configuration"]["urls"]["streaming"] == expected_ws_base

    raw_v1 = httpx.get(f"{base}/api/v1/instance").json()
    assert raw_v1["urls"]["streaming_api"] == expected_ws_base


def test_user_stream_delivers_followed_post(mastodon_mock_server: MockServer) -> None:
    """A followee's post appears as an ``update`` on the follower's user stream."""
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.me().id)

    with mastodon_mock_server.stream("user", username="alice") as events:
        bob.status_post("live from bob!")
        payload = events.next("update", timeout=5)
        assert "live from bob" in payload["content"]


def test_public_stream(mastodon_mock_server: MockServer) -> None:
    """Public posts reach the public stream."""
    alice = mastodon_mock_server.client("alice")
    with mastodon_mock_server.stream("public") as events:
        alice.status_post("public hello")
        payload = events.next("update", timeout=5)
        assert "public hello" in payload["content"]


def test_hashtag_stream(mastodon_mock_server: MockServer) -> None:
    """A tagged public post reaches the matching hashtag stream."""
    alice = mastodon_mock_server.client("alice")
    with mastodon_mock_server.stream("hashtag", tag="cats") as events:
        alice.status_post("I love #cats")
        payload = events.next("update", timeout=5)
        assert "cats" in payload["content"]


def test_delete_event(mastodon_mock_server: MockServer) -> None:
    """Deleting a status emits a ``delete`` carrying the bare id."""
    alice = mastodon_mock_server.client("alice")
    with mastodon_mock_server.stream("public") as events:
        post = alice.status_post("to be deleted")
        events.next("update", timeout=5)
        alice.status_delete(post["id"])
        deleted = events.next("delete", timeout=5)
        assert str(deleted) == str(post["id"])


def test_notification_event(mastodon_mock_server: MockServer) -> None:
    """A favourite on the author's post streams a ``notification`` to them."""
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    with mastodon_mock_server.stream("user", username="bob") as events:
        post = bob.status_post("notice me")
        events.next("update", timeout=5)
        alice.status_favourite(post["id"])
        note = events.next("notification", timeout=5)
        assert note["type"] == "favourite"


def test_direct_conversation_stream(mastodon_mock_server: MockServer) -> None:
    """A direct status reaches the recipient's direct stream as a conversation."""
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    bob_acct = bob.me().acct
    with mastodon_mock_server.stream("direct", username="bob") as events:
        alice.status_post(f"@{bob_acct} secret", visibility="direct")
        conv = events.next("conversation", timeout=5)
        assert "secret" in conv["last_status"]["content"]


def _ws_base(server: MockServer) -> str:
    return server.base_url.replace("https://", "wss://").replace("http://", "ws://")


def test_websocket_stream_uses_real_wire_format(mastodon_mock_server: MockServer) -> None:
    """The WS transport frames events like real Mastodon: one JSON object per message
    with a double-encoded ``payload`` (except ``delete``, whose payload is the bare id).

    Real instances dropped the SSE transport in Mastodon 4.2, so the bundled browser
    client (ui/src/app/streaming.ts) streams over WebSocket exclusively — this proves
    the endpoint it depends on end to end.
    """
    import json

    from websockets.sync.client import connect

    alice = mastodon_mock_server.client("alice")
    with connect(f"{_ws_base(mastodon_mock_server)}/api/v1/streaming?stream=public") as ws:
        post = alice.status_post("ws hello")
        frame = json.loads(ws.recv(timeout=5))
        assert frame["stream"] == ["public"]
        assert frame["event"] == "update"
        payload = json.loads(frame["payload"])  # payload is a JSON-encoded *string*
        assert "ws hello" in payload["content"]

        alice.status_delete(post["id"])
        frame = json.loads(ws.recv(timeout=5))
        assert frame["event"] == "delete"
        assert frame["payload"] == str(post["id"])


def test_websocket_user_stream_authenticates_via_query_token(
    mastodon_mock_server: MockServer,
) -> None:
    """``stream=user`` resolves the account from the ``access_token`` query param
    (browser WebSocket APIs cannot set an ``Authorization`` header)."""
    import json

    from websockets.sync.client import connect

    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.me().id)

    url = (
        f"{_ws_base(mastodon_mock_server)}/api/v1/streaming"
        f"?stream=user&access_token={alice.access_token}"
    )
    with connect(url) as ws:
        bob.status_post("ws live from bob!")
        frame = json.loads(ws.recv(timeout=5))
        assert frame["event"] == "update"
        assert "ws live from bob" in json.loads(frame["payload"])["content"]


def test_streaming_disabled_404s() -> None:
    """With streaming off, the routes 404 (but health still answers)."""
    import httpx2 as httpx

    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=DEFAULT_TEST_SEED,
        streaming=StreamingConfig(enabled=False),
    )
    with MockServer(config=config) as server:
        base = server.base_url
        assert httpx.get(f"{base}/api/v1/streaming/health").status_code == 200
        assert httpx.get(f"{base}/api/v1/streaming/public").status_code == 404
        # The streaming URL is no longer advertised as this origin.
        raw_v1 = httpx.get(f"{base}/api/v1/instance").json()
        assert raw_v1["urls"]["streaming_api"] != base
