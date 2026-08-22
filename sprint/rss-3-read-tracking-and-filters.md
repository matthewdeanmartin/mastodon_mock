# RSS Sprint 3 — Read/unread, starring, headline density in the split pane

Status: PLANNED (renumbered 2026-08-23 from the original Sprint 2 — see [[rss-2-split-pane-shell]]
for why; this sprint's content is the original Sprint 2's read-tracking work, adapted to sit inside
the split-pane shell instead of a single-column list with a mode toggle)

Depends on: [[rss-2-split-pane-shell]]

## Goal

Everything the original Sprint 2 planned for read/unread, starring, and scan-density — but landing
in the right pane of the split-pane shell rather than as a page-level headline/article toggle. The
underlying stores (2a/2b below) are unchanged from the original plan; only where and how they're
rendered changes, because the page shape changed out from under them.

## 3a. Read-state store

New service, same shape as `RssSubscriptions` (`providers/rss/rss-subscriptions.ts`):
account-scoped `localStorage` key via `scopedKey`, one signal, persisted on every write.

- **Key**: composite of feed URL + item id (RSS items already get an id — check how
  `feedToStatuses` derives `Status.id` from a parsed item today and reuse the same derivation, so
  read-state ids and rendered-item ids never drift apart).
- **Shape**: map/set of `{ id: string, readAt: number }` rather than a bare id set — the 90-day
  wipe (mentioned in the epic overview as roadmapped, not committed to this sprint) needs a
  timestamp to prune against later; store it now even if nothing reads it yet, since retrofitting a
  timestamp onto an id-only store later means a migration.
- **API surface**: `isRead(feedUrl, itemId)`, `markRead(feedUrl, itemId)`,
  `markAllRead(feedUrl)` (bulk, for one feed or one category — see 3c), `markUnread` (undo). Keep it
  a plain store, no business logic about *when* something counts as read — that's 3c's job.
- Register the new key in `storage-registry.ts` (`make storage` gate — see
  [[project-mimb-observability]]).

## 3b. All/Starred filter + starring

- Starring needs its own small store or an extra field alongside read-state — same
  account-scoped-localStorage pattern. Keep it a separate concern from read/unread even though
  they're stored similarly: a read item can be starred, an unread item can be starred, they are
  independent booleans, don't conflate them into one enum.
- The right pane (whatever it's currently showing — one feed, a merged category, or "All") gets an
  All/Starred toggle filtering the visible item list client-side — no new fetch, this filters what's
  already loaded via [[rss-2-split-pane-shell]]'s `getFeed()`/merge calls.
- Star action needs a visible affordance on each right-pane row — a tap target that doesn't require
  opening the item.

## 3c. Scroll-tracking setting + explicit mark-read

Two ways an item becomes read, both must exist:

- **Explicit**: opening an item (navigating into its article/headline detail — see 3d for what
  "opening" means once headline density exists) marks it read immediately. Always works, no setting
  required.
- **Scroll tracking**: an opt-in preference (`ClientPrefs`, same home as `setRssCacheTtlHours` and
  other RSS prefs already living there) that marks items read as they scroll past a visibility
  threshold in the right pane. Off by default — the boss listed it as "a setting for," implying
  opt-in, and silent mark-as-read on scroll is the kind of thing that surprises people if it's not
  something they turned on.
- **Mark all as read** — per-feed and per-category (bulk call into `markAllRead`), reachable from
  the left rail (a feed/category row's own action) since that's where the boss's Google Reader
  comparison puts it.

## 3d. Headline density, as a right-pane density toggle — not a separate page mode

The original plan called this "headlines vs. article view toggle," framed as switching the whole
page between two renderers. In the split-pane shape that doesn't fit as cleanly — the right pane
already *is* the Google-Reader-style list, and `app-status-card` ([[rss-2-split-pane-shell]]) is
already the per-item renderer reused from the profile page. What's actually needed:

- **Headline mode**: a dense row rendering (title, feed name/host, read-state dot, star, timestamp,
  no body) as an alternative to `app-status-card`'s fuller rendering, toggled per-session at the
  right-pane level — this is genuinely new UI, `app-status-card` was not built to be this compact
  and should not be bent into doing so; a separate lightweight component is cleaner than adding a
  "dense" input to a component used everywhere else in the app.
- Read state (3a) and star state (3b) apply identically regardless of which rendering is active —
  same underlying item list, different row templates.
- Opening an item from headline mode: needs a decision this doc doesn't make — does it expand
  inline in the right pane, or route to the existing thread/reader view
  ([[rss-2-split-pane-shell]]'s stated boundary that thread/reader stays untouched)? The Google
  Reader precedent expands inline; the boss's "still see it in the old profile/thread view"
  requirement was about Home click-throughs specifically, not necessarily this path. Ask before
  building.

## Out of scope for Sprint 3

Long-article pagination and full article extraction (Sprint 4, reuses the readability pipeline).
Starter kits, friend-link extraction, search-based discovery (Sprint 4). Comments,
share-to-Mastodon, friends'-shared-items synthetic feed, folders (unless [[rss-2-split-pane-shell]]'s
open "categorized = folders?" question resolves toward building them, in which case this note is
stale — check that sprint's outcome first), 90-day auto-wipe job (the timestamp is stored starting
this sprint; the prune job itself is not built yet — later).

## Test/verify notes

- Read-state and star stores both need `storage-registry.ts` entries.
- Scroll-tracking needs a real scroll-driven Playwright check per `.claude/skills/verify`'s runtime
  conventions (SPA at `/_ui/`) — an IntersectionObserver-based implementation is easiest to test
  deterministically; avoid raw scroll-position math if a simpler observer-based approach covers it.
- Verify mark-all-read from the left rail actually scopes to the right feed/category and does not
  silently mark everything read — a Google Reader UI puts this control right next to several
  adjacent scopes (a feed, a folder, "all"), and picking the wrong scope by accident is the
  single most embarrassing bug this sprint could ship.
