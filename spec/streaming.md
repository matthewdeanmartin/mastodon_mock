# Streaming API

This document specifies the **streaming** support added to `mastodon_mock`: a real
Server-Sent-Events (SSE) stream over HTTP that lets client code exercise live timeline
and notification handling — `Mastodon.py`'s `stream_user`, `stream_public`,
`stream_hashtag`, `stream_list`, and `stream_direct`.

It belongs to the same family as the rest of [03-api-coverage.md](03-api-coverage.md):
behaviour that a static mock (Mockoon, recorded fixtures) cannot reproduce, because the
events are derived from the mock's own write paths.

## Why SSE, not WebSocket

`Mastodon.py` streams over **HTTP SSE**, not WebSocket. Its `__stream` helper issues a
plain `GET` with `stream=True` against `/api/v1/streaming/*` and parses
`text/event-stream` (`event:` / `data:` lines, blank-line dispatch, `:`-prefixed
heartbeats — see `Mastodon.py/mastodon/streaming.py::StreamListener.handle_stream`). A
real Mastodon *also* offers a WebSocket multiplexed stream for browsers, but the Python
client never uses it. The mock therefore implements **SSE only**; this is sufficient for
the stated goal (driving Mastodon.py clients) and far simpler to host inside the existing
FastAPI app.

## Streaming base URL (the redirect trap)

`Mastodon.py.__get_streaming_base()` reads `instance.urls.streaming_api` (v1) /
`instance.configuration.urls.streaming` (v2). If that URL's netloc **differs** from
`api_base_url`, the client rewrites `wss://host` → `https://host` and connects there
instead. The mock runs everything on one port, so it must advertise the streaming URL as
**the same origin the request came in on**, so that the client falls through to
`api_base_url` and stays on the mock.

Consequently the instance serializers no longer hard-code `wss://{domain}`; the instance
router rewrites `urls.streaming_api` / `configuration.urls.streaming` to the live request
base URL (e.g. `http://127.0.0.1:54321`). This is the single change that makes streaming
"just work" through Mastodon.py with no client configuration.

## Endpoints

| Endpoint | Channel | Auth | Events delivered |
|--------------------------------------|-----------------------|----------|-----------------------------------------------|
| `GET /api/v1/streaming/user`         | `user`                | required | home-timeline `update`, `delete`, `status_update`, `notification` for the authed account |
| `GET /api/v1/streaming/public`       | `public`              | optional | every public `update` / `delete` / `status_update` |
| `GET /api/v1/streaming/public/local` | `public:local`        | optional | public events from **local** (no-domain) accounts |
| `GET /api/v1/streaming/public/remote`| `public:remote`       | optional | public events from accounts that have a `domain` |
| `GET /api/v1/streaming/hashtag?tag=` | `hashtag`             | optional | public `update`s tagged with `tag` |
| `GET /api/v1/streaming/hashtag/local?tag=` | `hashtag:local` | optional | as above, local only |
| `GET /api/v1/streaming/list?list=`   | `list`                | required | `update`s from accounts on the given list |
| `GET /api/v1/streaming/direct`       | `direct`              | required | `conversation` events for the authed account |
| `GET /api/v1/streaming/health`       | —                     | none     | returns `OK` (text), for `stream_healthy()` |

All streams respond `200` with `Content-Type: text/event-stream` and stay open until the
client disconnects.

### Wire format

Each event is encoded exactly as Mastodon does and as Mastodon.py parses:

```
event: update
data: {"id":"42", ... full Status JSON ... }

```

(`event:` line, one `data:` line containing the serialized entity as compact JSON, then a
blank line.) A `delete` event's `data` is the bare status id string. Heartbeats are a
single line `:thump\n` emitted every `heartbeat_seconds` (default 15) so idle connections
and proxies stay alive; Mastodon.py routes these to `handle_heartbeat()`.

## Event sources

Events are published from the existing write paths via a small in-process **event bus**
(`mastodon_mock/streaming.py`), not by polling the database. Because the mock is a single
process with one shared engine, an in-memory pub/sub is exact and synchronous:

| Write path | Published event(s) |
|-------------------------------------------|-------------------------------------------------|
| `POST /api/v1/statuses` (immediate)       | `update` to `public`/`hashtag`/author-follower `user` channels; `conversation` to recipients for `direct` visibility |
| `PUT /api/v1/statuses/{id}` (edit)        | `status_update` to the same channels |
| `DELETE /api/v1/statuses/{id}`            | `delete` (id payload) to the same channels |
| any `add_notification(...)` side effect   | `notification` to the recipient's `user` channel |

Visibility routing matches the REST timelines:

- `public` / `unlisted` statuses → `public` (+ `public:local`/`public:remote` by author
  domain) and each `hashtag` channel for their tags.
- `public` / `unlisted` / `private` statuses → the `user` channel of every account that
  **follows the author** (their home timeline), plus the author's own `user` channel.
- `direct` statuses → a `conversation` event on the `direct` channel of every mentioned
  recipient (and the author).
- `list` channel receives an author's `update` when the subscriber has that author on the
  named list.

The bus delivers the **already-serialized** entity captured at publish time, so each
subscriber does not re-query; per-subscriber viewer-relative fields (e.g. `favourited`)
are intentionally not personalised on the stream (consistent with how Mastodon's
streaming payloads are built once per visibility scope).

## Configuration

```toml
[tool.mastodon_mock.streaming]
enabled = true            # default true; set false to 404 the streaming routes
heartbeat_seconds = 15    # SSE keep-alive cadence
queue_maxsize = 1000      # per-subscriber buffer; oldest dropped if a client stalls
```

When `enabled = false`, all `/api/v1/streaming/*` routes (except `health`) return `404`,
matching an instance with streaming switched off, so clients can test that branch too.

## Testing helpers

`MockServer` gains conveniences so streaming tests don't hand-roll threads:

```python
def test_user_stream(mastodon_mock_server):
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.me().id)

    with mastodon_mock_server.stream("user", username="alice") as events:
        bob.status_post("live!")
        evt = events.next("update", timeout=5)      # blocks until an update arrives
        assert "live!" in evt.content
```

`MockServer.stream(channel, *, username=None, token=None, tag=None, list_id=None)` returns
a `StreamCollector` context manager backed by a real Mastodon.py `StreamListener` running
`run_async=True`. `next(event_name, timeout=...)` pops the next matching parsed event;
`events.all()` returns everything received so far. The collector closes the connection on
exit.

## Non-goals

- **No WebSocket / multiplexed stream.** Mastodon.py doesn't use it; out of scope.
- **No `filters_changed` / `announcement*` stream events.** Wired as no-ops; can be added
  if a client needs them.
- **No back-fill.** A stream only delivers events that occur **after** it connects, like a
  real server. Use the REST timeline endpoints for history.
- **No cross-process delivery.** The bus is in-process; a file-backed DB shared by two
  separate server processes will not see each other's events (the mock is single-process
  by design).
