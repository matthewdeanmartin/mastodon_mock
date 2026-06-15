# What Is and Isn't Mocked

This page summarises how faithfully each part of the Mastodon API is implemented, so you
know — before you assert on something — whether you're testing real behaviour or a
placeholder. The authoritative, endpoint-by-endpoint matrix (with the exact Mastodon.py
method that hits each route) lives in the
[API coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md).

## Coverage levels

| Level | Meaning |
| ---------- | ------------------------------------------------------------------------------------------- |
| **Full** | Real, persisted state. Writes are reflected in later reads. Safe to assert behaviour on. |
| **Static** | Fixed-shape response, no persistence. The shape is correct; the values don't change. |
| **Stub** | Minimal valid shape (usually an empty list/dict) so the client doesn't error. No behaviour. |
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
- **Scheduled statuses** — list, get, update, delete.
- **Timelines** — home, public (with `local` / `remote` filters), hashtag, list. With
  `max_id` / `min_id` / `since_id` / `limit` paging and `Link` headers.
- **Notifications** — list (filterable by type/account), get, unread count, clear, dismiss;
  and the full **grouped** notifications API (`/api/v2/notifications*`).
- **Media** — upload (bytes stored and served back), fetch, metadata update
  (`description` / `focus`).
- **Search** — v1 and v2, over local accounts, status content, and hashtags.
- **Lists** — full CRUD plus membership add/remove.
- **Favourites & bookmarks** — list endpoints.
- **Filters** — v1 and v2 CRUD, plus v2 keyword add/remove.
- **Conversations** — derived from `direct`-visibility statuses; mark-as-read.
- **Preferences & markers** — read preferences; get/set markers.
- **Polls** — fetch and vote (recomputes counts and `own_votes`).

## Static (correct shape, fixed values)

The response is well-formed and stable, but nothing changes in response to your actions:

- **Instance metadata** — `/api/v1/instance`, `/api/v2/instance` (including `api_versions`),
  nodeinfo, rules, extended description, languages — all built from your config.
- **OAuth server metadata** — `/.well-known/oauth-authorization-server`, `/oauth/userinfo`.
- **Directory** — `/api/v1/directory` (sorts/filters real seeded accounts, but the listing
  itself is read-only).
- **Status translation** — returns the original content verbatim with a fixed provider.

## Stubs (empty/minimal, no behaviour)

These exist so client flows that touch them in passing don't blow up, but they have no real
data:

- Instance: `activity`, `peers`, `custom_emojis`, `announcements`,
  `translation_languages`, `domain_blocks`, `terms_of_service`.
- Trends, follow suggestions, featured/followed tags, endorsements listing.
- Notification policy (`/api/v2/notifications/policy`) and notification requests.
- `filter_statuses_v2` (empty list), `timeline_link` (empty list).
- `email_resend_confirmation` (accepts and does nothing).

## Out of scope (not routed — expect `404`)

Whole modules and a few endpoints are intentionally absent. Calling them raises
`MastodonNotFoundError` / `MastodonAPIError`:

- **Admin API** (`mastodon/admin.py`).
- **WebPush / VAPID** (`mastodon/push.py`).
- **Streaming / WebSocket** (`mastodon/streaming.py`).
- **Moderation reports** (`/api/v1/reports`).
- **Tag follow/unfollow.**
- Quote revocation and quote-approval-policy endpoints.
- Filter-status add/get/delete (the v2 `filter_statuses` *write* side).
- Announcement dismiss/reactions (there are no announcements to act on).

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

When in doubt, the [coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md) lists every route and the
Mastodon.py call that reaches it.
