# RSS Sprint 2 — Read/unread, All/Starred, headlines vs. article view

Status: PLANNED
Depends on: [[rss-1-nav-and-page-skeleton]]

## Goal

Turn the Sprint 1 `/rss` skeleton (a flat list of feeds you can add to) into an actual reading
surface with the postures the boss described: track what's read, filter to starred/unread, and
switch between a dense headline list and an expanded article list.

## 2a-pre. Smart "Add a feed" (moved up from a future sprint, 2026-08-22)

Sprint 1 shipped a plain paste-a-feed-URL dialog (`AddFeedDialog` / `RssAddFeed`). The boss wants a
fallback ladder instead of a single fetch-or-fail attempt:

1. **Direct fetch** — today's behavior, unchanged.
2. **Mawkingbird Plus proxy** — if direct fails and the user's proxy is Mawkingbird Plus, retry
   through it automatically rather than making the user click "try via proxy" themselves. (The
   existing manual retry button stays for every *other* configured proxy — this step is specifically
   about not making a paying Plus user do a step their subscription should skip. Confirm with the
   boss whether "automatically" means genuinely no click, or one fewer click than today.)
3. **Not a feed at all — discover one** — if the URL parses as HTML rather than RSS/Atom, look for
   `<link rel="alternate" type="application/rss+xml">` / `atom+xml` references on that page (reusing
   the `article`-route/CORS-proxy fetch plumbing already used for read-mode article expansion —
   see [[project-mimb-readability]]). If exactly one feed is found, offer to subscribe to it
   directly. If several, show a picker instead of guessing.

This is a superset of what `RssAddFeed.add()` does today — extend that service (or wrap it) rather
than duplicating the fetch/subscribe logic a second time. Step 3's discovery logic is the same
capability Sprint 3's 3b (friend-link extraction) needs, so build the parser once and have both
consumers call it, rather than writing it twice on two different sprints.

## 2a. Read-state store

New service, same shape as `RssSubscriptions` (`providers/rss/rss-subscriptions.ts`):
account-scoped `localStorage` key via `scopedKey`, one signal, persisted on every write.

- **Key**: composite of feed URL + item id (RSS items already get an id — check how
  `feedToStatuses` derives `Status.id` from a parsed item today and reuse the same derivation, so
  read-state ids and rendered-item ids never drift apart).
- **Shape**: map/set of `{ id: string, readAt: number }` rather than a bare id set — the 90-day
  wipe (mentioned in the overview as roadmapped, not committed to this sprint) needs a timestamp to
  prune against later; store it now even if nothing reads it yet, since retrofitting a timestamp
  onto an id-only store later means a migration.
- **API surface**: `isRead(feedUrl, itemId)`, `markRead(feedUrl, itemId)`,
  `markAllRead(feedUrl)` (for the mark-all button), `markUnread` (undo). Keep it a plain store, no
  business logic about *when* something counts as read — that's 2c's job.
- Register the new key in `storage-registry.ts` (`make storage` gate — see
  [[project-mimb-observability]]).

## 2b. All/Starred filter + starring

- Starring needs its own small store or an extra field alongside read-state — same
  account-scoped-localStorage pattern. Keep it a separate concern from read/unread even though
  they're stored similarly: a read item can be starred, an unread item can be starred, they are
  independent booleans, don't conflate them into one enum.
- `/rss` page gets a two-way toggle (All / Starred) filtering the visible item list client-side —
  no new fetch, this filters what's already loaded.
- Star action needs a visible affordance on both headline and article rows (2d) — a tap target that
  doesn't require opening the item.

## 2c. Scroll-tracking setting + explicit mark-read

Two ways an item becomes read, both must exist:

- **Explicit**: opening an item (navigating into its article/headline detail) marks it read
  immediately. This always works, no setting required.
- **Scroll tracking**: an opt-in preference (`ClientPrefs`, same home as `setRssCacheTtlHours` and
  other RSS prefs already living there) that marks items read as they scroll past a visibility
  threshold in the headline list, the way a feed reader traditionally does. Off by default — the
  boss listed it as "a setting for," implying opt-in, and silent mark-as-read on scroll is the kind
  of thing that surprises people if it's not something they turned on.
- **Mark all as read** button on the page (or per-feed) — bulk call into `markAllRead`.

## 2d. Headlines vs. article (condensed) view toggle

Two render modes for the item list, switchable per-session (a page-level toggle, not per-feed):

- **Headlines**: dense rows — title, feed name/host, read-state dot, star, timestamp. No body
  text. This is the mode scroll-tracking (2c) is designed around — you can scan many headlines
  fast.
- **Articles**: the existing card-style rendering (whatever `/rss`'s Sprint 1 skeleton already
  renders per item) — title + summary/preview, closer to how Home renders an RSS-sourced `Status`
  today.
- Read state (2a) and star state (2b) apply identically in both modes — same underlying item list,
  different row templates.

## Out of scope for Sprint 2

Long-article pagination and full article extraction (Sprint 3, reuses the readability pipeline).
Starter kits, friend-link extraction, search-based discovery (Sprint 3). Comments,
share-to-Mastodon, friends'-shared-items synthetic feed, folders, 90-day auto-wipe job (the
timestamp is stored starting this sprint; the prune job itself is not built yet — later).

## Test/verify notes

- Read-state and star stores both need `storage-registry.ts` entries.
- Scroll-tracking needs a real scroll-driven Playwright check per `.claude/skills/verify`'s runtime
  conventions (SPA at `/_ui/`) — an IntersectionObserver-based implementation is easiest to test
  deterministically; avoid raw scroll-position math if a simpler observer-based approach covers it.
