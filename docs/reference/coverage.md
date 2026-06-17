# What Is and Isn't Mocked

This page summarises how faithfully each part of the Mastodon API is implemented, so you
know — before you assert on something — whether you're testing real behaviour or a
placeholder. The authoritative, endpoint-by-endpoint matrix (with the exact Mastodon.py
method that hits each route) lives in the
[API coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md).

## Coverage levels

| Level | Meaning |
|------------|---------------------------------------------------------------------------------------------|
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
- **Quotes (write)** — revoke a quote of your status (`status_quote_revoke`, which sets the
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
  and the full **grouped** notifications API (`/api/v2/notifications*`).
- **Media** — upload (bytes stored and served back), fetch, metadata update
  (`description` / `focus`).
- **Search** — v1 and v2, over local accounts, status content, and hashtags.
- **Lists** — full CRUD plus membership add/remove.
- **Favourites & bookmarks** — list endpoints.
- **Filters** — v1 and v2 CRUD, plus v2 keyword add/remove **and v2 status
  attach/detach** (`filter_statuses`).
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
- **Admin / moderation API** (`mastodon/admin.py`) — account listing & filtering (v1 + v2),
  account moderation actions (enable / approve / reject / silence / suspend / sensitive /
  delete) and `admin_account_moderate`, the report queue (list / fetch / assign / unassign /
  resolve / reopen), and CRUD for domain blocks, domain allows, email-domain blocks,
  canonical-email blocks, and IP blocks. **Auth is faked — there is no role enforcement** (any
  authenticated account may call these), consistent with the "no real security" non-goal.
- **Mock-only development helpers** — reset the database to seed state, mint tokens for
  seeded users, create/list dev users, and append capped sample-data cohorts.

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
- **Notification policy** — a fixed "accept everything" policy (PATCH accepted and ignored).

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
- **Notification requests** — empty (the "accept everything" policy filters nothing), with
  the full request family (`accept`/`dismiss`/`merged`) wired as no-ops.

## Stubs (empty/minimal, no behaviour)

These exist so client flows that touch them in passing don't blow up, but they have no real
data:

- `timeline_link` (empty list), trending `links` / `admin/trends/links` (empty).
- Admin measures / dimensions / retention — correctly-shaped but zero/empty values.
- `email_resend_confirmation` (accepts and does nothing).

## Out of scope (not routed — expect `404`)

Whole modules and a few endpoints are intentionally absent. Calling them raises
`MastodonNotFoundError` / `MastodonAPIError`:

- **WebPush / VAPID** (`mastodon/push.py`).
- **Streaming / WebSocket** (`mastodon/streaming.py`).
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
- **The bundled UI is a client of the same API.** It is served at `/_ui/` when built and
  uses the mock-only dev helpers plus regular Mastodon/admin endpoints.

When in doubt, the [coverage spec](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/03-api-coverage.md)
lists every route and the
Mastodon.py call that reaches it.
