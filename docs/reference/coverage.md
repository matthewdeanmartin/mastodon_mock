# What Is and Isn't Mocked

This page summarises how faithfully each part of the Mastodon API is implemented, so you
know — before you assert on something — whether you're testing real behaviour or a
placeholder. The authoritative, endpoint-by-endpoint matrix (with the exact Mastodon.py
method that hits each route) lives in the
[API coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md).

## Coverage levels

| Level | Meaning |
|------------|---------------------------------------------------------------------------------------------|
| **Stateful** | Persisted state affects later reads or writes. Safe to assert behavior on. |
| **Derived** | Computed from mock state, but not a reproduction of Mastodon's ranking/analytics engine. |
| **Static** | Fixed response, no persistence. Intended for shape/client-flow compatibility. |
| **No-op** | Accepts the operation but deliberately records no behavior. |
| **OOS** | Out of scope — the route isn't implemented; the client gets a `404`. |

## Fully stateful (assert freely)

These behave like a real server: write something, read it back, and it's there — with the
relationships, notifications, and pagination you'd expect.

- **Auth & apps** — app registration, `client_credentials` and `refresh_token` grants,
  token revocation, self-service account creation, `app_verify_credentials`.
- **Accounts** — profiles, `verify_credentials` (with the `source` block), an account's
  statuses (with `only_media` / `pinned` / `exclude_replies` / `exclude_reblogs` / `tagged`
  filters), followers/following, relationships, lookup, search, familiar followers.
- **Account actions** — follow/unfollow, block/unblock, mute/unmute, remove-from-followers,
  `update_credentials` (including `fields`, avatar/header upload), pin/endorse, account notes.
- **Relationships** — mutes, blocks, follow requests (authorize/reject), domain blocks.
- **Statuses (read)** — single + bulk fetch, context (ancestors/descendants), reblogged-by,
  favourited-by, edit history, source, quotes.
- **Statuses (write)** — post (with `@mention` and `#hashtag` parsing, `in_reply_to_id`,
  `visibility`, `sensitive`, `spoiler_text`, `language`, `media_ids`, polls, quotes,
  `scheduled_at`, `idempotency_key`), edit, delete, reblog/unreblog, favourite/unfavourite,
  mute/unmute, pin/unpin, bookmark/unbookmark.
- **Quotes (write)** — quote approval policy is enforced when creating a quote; revoke a quote of your status (`status_quote_revoke`, which sets the
  quoting status's `quote.state` to `revoked` and hides the quoted status) and update a
  status's quote-approval policy (`status_update_quote_approval_policy`; private/direct
  statuses are forced to `nobody`).
- **Hashtags** — follow / unfollow and feature / unfeature a tag, list followed and
  featured tags (all persisted), featured-tag suggestions, plus `tag()` fetch with
  viewer-relative `following` / `featuring`.
- **Scheduled statuses** — list, get, update, delete.
- **Timelines** — home, public (with `local` / `remote` filters), hashtag, list. With
  `max_id` / `min_id` / `since_id` / `limit` paging and `Link` headers.
- **Notifications** — list (filterable by type/account), get, unread count, clear, dismiss;
  persisted per-account filtering policy, notification request groups with
  accept/dismiss/merge behavior, and the full **grouped** notifications API
  (`/api/v2/notifications*`).
- **Media** — upload (bytes stored and served back), fetch, metadata update
  (`description` / `focus`).
- **Search** — v1 and v2, over local accounts, status content, and hashtags.
- **Lists** — full CRUD plus membership add/remove.
- **Favourites & bookmarks** — list endpoints.
- **Filters** — v1 and v2 CRUD, v2 keyword/status attach/detach, and viewer-relative
  `Status.filtered` results in home/public/thread/account/notification contexts.
- **Conversations** — derived from `direct`-visibility statuses; mark-as-read.
- **Announcements** — listed from config-seeded announcements, with per-user
  dismiss (`read`) and emoji reactions (`announcement_dismiss` /
  `announcement_reaction_create` / `announcement_reaction_delete`).
- **Terms of service** — `terms_of_service` returns the configured ToS, or `404`
  when none is set (config-driven, like instance `rules`).
- **Preferences & markers** — read preferences; get/set markers.
- **Polls** — fetch and vote (recomputes counts and `own_votes`).
- **Reports** — `report()` files a moderation report against an account (this is what
  populates the admin queue).
- **Push subscription CRUD** — create/fetch/update/delete one persisted subscription per
  OAuth token. This models subscription state only; encrypted delivery is not implemented.
- **Streaming** (SSE) — `stream_user`, `stream_public` (+ `local`/`remote`),
  `stream_hashtag` (+ `local`), `stream_list`, `stream_direct`, and `stream_healthy`.
  Events (`update` / `status_update` / `delete` / `notification` / `conversation`) are
  generated as side effects of the same write paths as the REST API, routed by
  visibility. The legacy WebSocket multiplex endpoint is also implemented. See
  [streaming spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/streaming.md).
- **Admin / moderation API** (`mastodon/admin.py`) — account listing & filtering (v1 + v2),
  account moderation actions (enable / approve / reject / silence / suspend / sensitive /
  delete) and `admin_account_moderate`, the report queue (list / fetch / assign / unassign /
  resolve / reopen), and CRUD for domain blocks, domain allows, email-domain blocks,
  canonical-email blocks, and IP blocks. **Auth is faked — there is no role enforcement** (any
  authenticated account may call these), consistent with the "no real security" non-goal.
  Moderation flags have observable effects: suspended/disabled accounts cannot use
  authenticated writes, limited accounts leave public discovery, forced-sensitive
  accounts serialize sensitive statuses, signup blocks are enforced, and trend review
  decisions affect public trends.
- **Mock-only development helpers** — reset the database to seed state, mint tokens for
  seeded users, create/list dev users, append capped sample-data cohorts, and a
  **fault-injection control plane** (`/api/v1/_mock/faults`) for forcing `5xx`/`429`,
  latency, malformed JSON, or timeouts on matching requests. See
  [fault-injection spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/fault_injection.md).

## Static (correct shape, fixed values)

The response is well-formed and stable, but nothing changes in response to your actions:

- **Instance metadata** — `/api/v1/instance`, `/api/v2/instance` (including `api_versions`),
  nodeinfo, rules, extended description, languages — all built from your config.
- **OAuth server metadata** — `/.well-known/oauth-authorization-server`, `/oauth/userinfo`.
- **Directory** — `/api/v1/directory` (sorts/filters real seeded accounts, but the listing
  itself is read-only).
- **Status translation** — "translates" by pig-latinizing the text (HTML-safe), so
  the result is deterministic and visibly differs from the source. No real engine.
- **Preview cards** — a status whose text contains a link gets a fixed dummy
  `PreviewCard` (pointing at that URL); link-free statuses have `card = null`. No
  URL crawling.
- **Custom emojis** — a small, fixed set in the correct `CustomEmoji` shape.
- **Translation languages** — each supported source language mapped to a fixed target set.

## Discovery (data-derived, correct shape)

These used to be empty stubs; they now return realistic, correctly-shaped content **derived
from the mock's own data**, so callers that iterate them get something to work with. They are
not full reproductions of Mastodon's ranking algorithms, but the shapes match a live server:

- **Instance `activity`** — 12 weeks of `{week, statuses, logins, registrations}` counted
  from your statuses/accounts.
- **Instance `peers`** — the distinct domains of your seeded "remote" accounts.
- **Instance `domain_blocks`** — derived from admin domain blocks (with a sha256 `digest`).
- **Trends** — trending **tags** ranked by local hashtag usage; trending **statuses** ranked
  by favourite count (both also exposed on the **admin** trends endpoints). Trending
  **links** is an empty list (no preview-card synthesis).
- **Follow suggestions** (`suggestions_v2`) — local accounts you don't already follow.
- **Endorsements** — the accounts you've endorsed (`relationships.endorsed`, i.e. pinned).
- **Follow suggestions** — local accounts you don't already follow, minus persisted
  dismissals.

## Stubs (empty/minimal, no behaviour)

These exist so client flows that touch them in passing don't blow up, but they have no real
data:

- `timeline_link` (empty list), trending `links` / `admin/trends/links` (empty).
- Admin measures / dimensions / retention — correctly-shaped but zero/empty values.
- `email_resend_confirmation` (accepts and does nothing).
- Mastodon 4.6 collections, annual reports, and async refresh status — routed for
  operation compatibility, but fixed/empty/no-op rather than stateful.
- Account identity proofs (empty).

## Out-of-scope behavior behind routed endpoints

No operation in the pinned Mastodon 4.6 OpenAPI schema is currently truth-only. The
remaining out-of-scope pieces are behavior behind routed endpoints:

- **Encrypted WebPush delivery / VAPID signing.** Subscription CRUD is stateful, but
  notification payloads are not encrypted, signed, or sent.
- **Federation / ActivityPub delivery** and remote account resolution.
- **Cross-process streaming** and stream replay.

## Cross-cutting behaviours worth knowing

- **Notifications are generated as side effects** of writes: a `@mention` in a post, a
  reblog, a favourite, and a follow each create a notification for the *other* account
  (a locked target gets a `follow_request` instead of a `follow`). Self-actions never
  notify, matching real Mastodon.
- **Edits build history.** Each `status_update` snapshots the previous state; `status_history`
  returns N+1 entries for N edits.
- **No federation.** Search never resolves remote handles; "remote" accounts exist only if
  you seed them with a `domain`.
- **Pagination is real.** List endpoints honour `max_id` / `min_id` / `since_id` / `limit`
  and emit a `Link` header, so Mastodon.py's `fetch_next` / `fetch_previous` work.
- **Moderation enforcement is configurable.** It is enabled by default for 4.6-oriented
  behavior; set `moderation.enforce_actions = false` for older permissive test suites.
- **The bundled UI is a client of the same API.** It is served at `/_ui/` when built and
  uses the mock-only dev helpers plus regular Mastodon/admin endpoints.

When in doubt, the [coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md)
lists every route and the
Mastodon.py call that reaches it.
