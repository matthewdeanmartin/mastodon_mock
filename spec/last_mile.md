# The Last Mile: Endpoints That Are Empty / Stubbed

> Companion to [03-api-coverage.md](03-api-coverage.md). That document is the
> authoritative route-by-route matrix. This one zooms in on the rows that are
> **Stub** (empty list / minimal shape, no behaviour), **Static** (fixed values),
> or **OOS** (404), and answers the practical question: *would it really be so
> hard to make these real?*
>
> The short answer: most of the remaining gaps are **deliberately** empty because
> the mock has no upstream data to derive them from (federation, web-crawled
> preview cards, time-series analytics). The cheap wins that *could* be made
> data-derived have already been done — see
> [§"Already implemented"](#already-implemented-2026-06-16) at the bottom.

## TL;DR triage table

This is the **remaining** backlog (the items already implemented are listed
separately at the bottom, not here).

| Endpoint                           | Current      | Effort        | Worth it?                          |
|------------------------------------|--------------|---------------|------------------------------------|
| `GET /api/v1/timelines/link`       | Stub `[]`    | **Easy**      | Maybe — only if a test iterates it |
| `GET /api/v1/trends/links`         | Stub `[]`    | **Medium**    | Low — needs preview-card synthesis |
| `GET /api/v1/admin/trends/links`   | Stub `[]`    | Medium        | Low — same as public trending links |
| `POST /api/v1/admin/measures`      | Static zeros | **Medium**    | Maybe — real counts are derivable  |
| `POST /api/v1/admin/dimensions`    | Static empty | **Medium**    | Maybe                              |
| `POST /api/v1/admin/retention`     | Static `[]`  | Hard          | No — needs cohort time-series      |
| `POST /api/v1/emails/confirmations`| Stub 200     | n/a (correct) | No — already correct               |
| Streaming (SSE)                    | **Full**     | done          | ✅ Implemented (2026-06-17)        |
| WebPush / VAPID                    | OOS          | Hard          | No — explicit non-goal             |

---

## 1. Cheap wins still on the table

The cheap wins this doc originally flagged (admin trends, filter-status CRUD,
announcements, terms of service) are all done now. What remains in this tier is
genuinely marginal:

### 1a. `GET /api/v1/timelines/link` — `routers/timelines.py:126`

The "trending links" timeline. Empty today. Could in principle return public
statuses that contain a URL, but without preview-card synthesis (see §2) the
result is thin. **Effort:** Easy to return *something*; **Worth it:** low.

---

## 2. Genuinely hard / deliberately empty (don't bother for v1)

These are empty not from laziness but because the mock has **no upstream source**
for the data. Faking them convincingly would mean re-implementing a Mastodon
subsystem.

### 2a. Trending links — `trends/links`, `admin/trends/links`

A "link" trend is a **preview card** (`PreviewCard`): title, description,
`image`, `author_name`, `provider_name`, embed HTML — all of which real Mastodon
gets by **crawling the URL's OpenGraph tags**. The mock doesn't fetch external
URLs (and shouldn't — that's network I/O in a test fixture), so it can't *rank*
real links. (Note: `status.card` *is* now populated with a deterministic dummy
card when a status contains a link — see §"Already implemented" — but that's a
fixed placeholder per status, not a crawled, rankable trend.) **Recommendation:**
leave the trending-links *list* as Stub.

### 2b. Admin measures / dimensions / retention — `routers/admin.py:824-857`

These are Mastodon's **analytics** endpoints — time-bucketed counts
(`measures`), top-N breakdowns (`dimensions`), and signup-cohort retention
curves (`retention`).

- `measures` and `dimensions` are *partly* derivable: e.g. `active_users`,
  `new_users`, `interactions`, `statuses` measures could be real `COUNT`s
  bucketed by day over the requested `start_at`/`end_at` window. **Medium**
  effort if you only support a few keys; the API defines ~10 measure keys and
  ~8 dimension keys, most needing their own query.
- `retention` requires grouping accounts into signup cohorts and tracking
  per-period activity — a real time-series join. **Hard**, and the seed data
  isn't temporally rich enough to make it meaningful.

**Recommendation:** the Static zero-shape is honest and sufficient for shape
assertions. Promote `measures`/`dimensions` to real counts *only* if a test
actually asserts on the numbers.

---

## 3. Already correct (not actually gaps)

A few "empty/None" responses look like stubs but are the **semantically correct**
answer and should not be changed:

- **`POST /api/v1/emails/confirmations`** — a 200 with empty body *is* the real
  response. Nothing to persist.
- **`GET /api/v1/statuses/{id}/card` (legacy route) → `None`** — on a 4.x server
  the card lives on the `Status.card` field (now populated, see §"Already
  implemented"); the pre-3.0 route staying empty is correct.
- **`GET /api/v2/notifications/policy` → "accept everything"** — a valid default
  policy; PATCH-and-ignore is fine because nothing in the mock filters
  notifications.
- **Notification *requests* family → empty** — a direct consequence of the
  accept-everything policy: with nothing filtered, there are no pending requests.
  Empty is correct, not a stub gap.
- **`instance/extended_description` → empty content** — valid for an instance
  with none configured (and config-driven if you want it non-empty).

---

## 4. Out of scope by design (won't implement)

Per [03-api-coverage.md](03-api-coverage.md) §"Modules entirely out of scope":

### WebPush / VAPID (`mastodon/push.py`) — what it is and why it's hard

**WebPush** is the W3C standard for delivering a notification to a browser/app
*even when the Mastodon UI isn't open*:

1. The client registers a **subscription** with the browser's push service
   (Mozilla, Google FCM, Apple APNs) and hands Mastodon three things: an
   **endpoint URL**, a **p256dh** public key, and an **auth** secret.
2. When something happens (mention, follow, …), Mastodon **encrypts** the payload
   (RFC 8291: ECDH against the p256dh key + an HKDF-derived AES-GCM key) and POSTs
   the ciphertext to the endpoint URL.
3. The push service relays it to the device, which decrypts and displays it.

**VAPID** (RFC 8292) is the auth layer: Mastodon holds an ECDSA P-256 keypair and
signs a JWT per push proving *this server* may push to *that subscription*. The
relevant Mastodon.py methods are `push_subscription`, `push_subscription_set`,
`push_subscription_update`, `push_subscription_decrypt_push`.

**Why it stays OOS:**

- The whole *point* of the feature is encrypted side-channel delivery — and there
  is **no real browser push service in a unit test** to deliver to. The endpoint
  URL points at Mozilla/Google infrastructure.
- Making it more than a stub means implementing RFC 8291 payload encryption +
  RFC 8292 JWT signing with real ECDH/ECDSA crypto — a lot of code whose only
  output is ciphertext nobody in the test can decrypt.
- It delivers **nothing a write-then-read test can assert on**: notifications are
  *already* fully observable via `GET /api/v1/notifications`. Push is just an
  alternate transport for the same data. (The subscription-CRUD half would be
  easy to persist, but it's pointless without the delivery half.)

### Streaming — now implemented (was OOS)

> **Update (2026-06-17): streaming is no longer out of scope — it's Full.** This
> subsection is kept for the historical reasoning; see
> [streaming.md](streaming.md) and §"Already implemented (2026-06-17)" for what
> shipped.

The original reasoning for deferring streaming, and why it no longer holds:

- *"It's opt-in in Mastodon.py / a write-then-read suite has no reason to reach
  it."* True, but real-time clients (the web UI, official + third-party apps,
  firehose bots) use streaming heavily, and they need a local target to test
  reconnect/dedup/ordering logic against. That's a capability no other local mock
  offers — which is exactly the niche this project fills.
- *"A request/response mock can't deliver deterministic live events."* The mock is
  a single process with one shared engine, so an **in-process pub/sub bus** fed by
  the existing write paths delivers events deterministically and synchronously. The
  `MockServer.stream(...)` helper makes "assert I got a live event when X happened"
  a few lines, not a racy hand-roll.
- *"Mastodon.py needs a WebSocket."* It doesn't — it streams over **HTTP SSE**, so
  the mock hosts an SSE stream inside the existing FastAPI app. The browser-only
  **WebSocket multiplex** remains OOS (Mastodon.py never uses it).

### WebPush / VAPID stays OOS

WebPush intentionally 404s (or simply isn't routed). That is the contract, not a
gap to close — for the reasons above (encrypted side-channel delivery with no
browser push service in a test, and nothing it surfaces that `notifications()`
doesn't already).

---

## Recommended order of work, if you do the rest of the last mile

The high-value cheap wins are already done. Of what's left, only one item is even
arguably worth it:

1. *(Optional, numbers only on demand)* **Admin measures/dimensions** (§2b) —
   real `COUNT`-based analytics, but only if a consumer asserts on the numbers.

Everything else (trending links, retention, WebPush) should stay as-is: the
empties are honest, and filling them means re-creating a Mastodon subsystem with no
real data behind it. **Streaming, formerly on this list, is now implemented** (see
below).

---

## Already implemented (2026-06-16)

These were the cheap wins this document originally flagged; they're now done. Two
of them ("translation" and preview cards) are deliberately fake but *visible*
test-fixture transforms — callers can assert on them, rather than getting empty or
verbatim-echoed output.

1. **Filter-status CRUD** — new `filter_statuses` table + model
   (`db/models.py`), migration `9a1c4e7d2f01`, `serialize_filter_status`
   (`serializers/misc.py`), and the four handlers in `routers/filters.py`
   (`filter_statuses_v2`, `add_filter_status_v2`, `filter_status_v2`,
   `delete_filter_status_v2`, owner-scoped). `serialize_filter_v2` now includes
   the attached statuses. The v2 filters API is now **Full** across the board.
2. **Admin trends** — `routers/instance.py` exposes shared `trending_tag_rows` /
   `trending_status_rows`; `admin_trending_tags`/`admin_trending_statuses`
   (`routers/admin.py`) reuse them and reshape to the admin entity. Admin
   trending *links* stays Stub (no card synthesis).
3. **Pig-Latin translation** — new `mastodon_mock/text.py`
   (`pig_latin_word`/`pig_latin_text`/`pig_latin_html`, HTML-tag/entity-safe);
   `status_translate` returns the pig-latinized content + spoiler text. It's a
   deterministic, obviously-fake transform, so `translated != original` (the old
   verbatim echo made round-trip translation tests meaningless).
4. **Dummy preview cards** — `_preview_card` in `serializers/statuses.py`
   synthesizes a fixed-shape `PreviewCard` pointing at the first URL in a
   status's text (`provider_name="mastodon_mock"`); statuses with no link keep
   `card == None`, matching real Mastodon. No URL crawling.
5. **Announcements** — new `announcements` / `announcement_dismissals` /
   `announcement_reactions` tables + models (`db/models.py`), migration
   `b2d5f8a3c014`, `serialize_announcement` (`serializers/announcements.py`),
   config-seeded via `SeedConfig.announcements`, and the four handlers in
   `routers/instance.py` (list + dismiss + reaction add/remove). `read` and
   reaction `count`/`me` are viewer-relative and persisted per account.
6. **Terms of service** — `config.terms_of_service` + `serialize_terms_of_service`;
   `instance_terms_of_service` returns the `TermsOfService` entity when set, else
   404 (matching an instance with none configured), exactly like `rules`.

Tests: `tests/test_contract_filters.py` (filter-status CRUD + 404 scoping),
`tests/test_contract_admin.py` (admin trends derived/empty),
`tests/test_contract_extended.py` (pig-latin translate, dummy card present/absent),
`tests/test_contract_announcements.py` (announcement list/dismiss/react + ToS),
`tests/test_unit.py` (pig-latin unit cases). Full suite green (283 passed); no
Alembic drift.

**Deliberately left alone:** trending links / `admin/trends/links` (no OG
crawling), `admin/{measures,dimensions,retention}` (real analytics), WebPush
(see §4).

## Already implemented (2026-06-17)

Two larger features landed, each with its own spec. Both deliver capabilities a
client developer cannot get from any other local mock.

1. **Streaming (SSE)** — see [streaming.md](streaming.md). `Mastodon.py` streams
   over HTTP Server-Sent-Events, so the mock hosts an SSE stream in the existing
   FastAPI app rather than a WebSocket.
   - `mastodon_mock/streaming.py` — a thread-safe, in-process pub/sub `EventBus`
     (publishers run on the route threadpool, subscribers on the loop; delivery via
     `loop.call_soon_threadsafe`) plus SSE encoding and channel-key helpers.
   - `mastodon_mock/streaming_events.py` — maps write-path side effects to events
     and routes them by visibility: `public` (+ `public:local`/`public:remote` by
     author domain), each author-follower's `user` (home) channel, `hashtag`
     (+ local), `list`, and `direct`→`conversation`; notifications go to the
     recipient's `user` channel.
   - `mastodon_mock/routers/streaming.py` — `stream_user` / `stream_public`
     (+ `/local`, `/remote`) / `stream_hashtag` (+ `/local`) / `stream_list` /
     `stream_direct` / `health`, each holding an SSE connection with a heartbeat.
   - Publishes wired into `routers/statuses.py` (post/edit/delete/reblog/favourite)
     and `routers/accounts.py` (follow); `services.add_notification` now buffers
     created rows for `flush_stream_notifications`.
   - **Streaming-base-URL fix:** `routers/instance.py` now advertises the streaming
     URL as the live request origin (not `wss://{domain}`), so `Mastodon.py`'s
     `__get_streaming_base()` falls through to `api_base_url` and stays on the mock.
   - Config: `StreamingConfig` (`[tool.mastodon_mock.streaming]`, on by default;
     `enabled=false` 404s the routes). Test helper: `MockServer.stream(...)` →
     `StreamCollector` with `.next(event, timeout=)` / `.all()`.
2. **Fault injection** — see [fault_injection.md](fault_injection.md). A mock-only
   control plane so clients can test retry/back-off, `429`, `5xx`, malformed-JSON,
   and timeout handling.
   - `mastodon_mock/faults.py` — `FaultStore` (ordered rules, glob/regex path
     matching, counted expiry) + middleware applying the first match
     (`status`/`ratelimit`/`latency`/`malformed`/`timeout`); the `/_mock/*` control
     plane is always exempt, and the middleware is added outermost so a fault
     short-circuits before scope/rate checks.
   - `/api/v1/_mock/faults` CRUD in `routers/oauth.py`; rules cleared by
     `/_mock/reset`. Config: `FaultConfig` (`[tool.mastodon_mock.faults]`, on by
     default; `enabled=false` 404s the routes). Test helper: `MockServer.fault(...)`
     → `FaultHandle` (auto-clears on context exit).

Tests: `tests/mock_only/test_streaming.py` (user/public/hashtag/delete/notification/
direct streams, the base-URL rewrite, disabled→404, all driven through real
`Mastodon.py`) and `tests/mock_only/test_faults.py` (status/ratelimit/malformed/
latency/glob effects, count expiry, control-plane exemption, reset, disabled→404).
Full suite green (301 passed); ruff + mypy clean on the new modules.

**Still deliberately OOS:** WebPush / VAPID, and the browser-only WebSocket
multiplexed stream (Mastodon.py uses SSE, not WebSocket).
