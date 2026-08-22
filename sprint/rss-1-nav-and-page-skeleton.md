# RSS Sprint 1 — Feeds nav rework, `/rss` skeleton, Home un-mixing

Status: PLANNED
Depends on: [[rss-0-overview]]

## Goal

Make room, and stop the mixing. Nothing here is about RSS *content* features yet (search, read
tracking, headlines) — that's Sprint 2+. This sprint is entirely: navigation shape, one new route
that can list and add feeds, and a classification rule that fixes what Home shows.

## 1a. Feeds landing page: drill-down category list

`pages/lists/lists.ts` currently renders `FEED_SECTIONS` as a `<select>`-style picker with every
section's rows stacked below it regardless of selection breadth. Replace the landing state
(`/feeds` with no category chosen) with:

- A vertical list of category rows, one per existing `FeedSection` value (reuse `FEED_SECTIONS`
  as the source of truth for the list — do not invent a new taxonomy).
- Each row shows its label immediately; a count badge appears once that section's data resolves
  (`— 12` or similar), matching the existing pattern of async-resolved server feeds
  (`resolveServerFeeds`) where rows appear before data is final and update in place.
- Clicking a row navigates to that section's filtered view — reuse the existing `showsSection`
  filtering the component already does, just make the picker's selection *be* the navigation
  instead of an in-page toggle. `section` becomes a route param or query param
  (e.g. `/feeds?section=rss`) rather than component state, so the filtered view is a real,
  linkable destination (needed for "3 clicks to a specific Bluesky feed").
- An **"All feeds"** row at the top of the list, always first, routing to the current
  everything-stacked view (today's `/feeds` behavior) — this is the explicit escape hatch back to
  the wall-of-text view for anyone who wants it. Do not remove that view; just stop defaulting to
  it.
- `/feeds/lists` and `/feeds/tags` keep working exactly as today (they're already filtered views
  via route `data: { only }`) — those routes don't need to change, only the landing page's default
  state does.

Counts: for sections that already fetch eagerly on `ngOnInit` (lists, tags, collections, server
feeds, RSS subs, Bluesky), the count is `array.length` once the relevant signal populates — no new
network calls. Do not add fetches whose only purpose is a nav badge; if a section's data isn't
loaded until the section is opened, its count shows blank/loading rather than triggering an eager
fetch on page load.

## 1b. Menu moves

In `shell/shell.html`'s `.more-menu`:

- Remove the `Lists` and `Tags` rows (`/feeds/lists`, `/feeds/tags`) — reachable via the Feeds
  landing page now (2 clicks: Feeds → Lists, or Feeds → Tags).
- Remove `Storage Diagnostics`. Placement: [ask the boss for the specific new home before landing
  this row-move — the overview flags this as "decided in Sprint 1" but doesn't commit to where;
  candidates are a Settings sub-page or folding into `/observability` which already sits in the
  same menu section]. Do not leave it unreachable — pick a destination before removing the row.
- `RSS feeds` row: keep pointing at `/settings/rss` (feed management stays there), but relabel to
  something that won't collide with the new primary-nav `/rss` — e.g. "Manage RSS feeds" — so the
  two aren't confused in the same menu/nav pass.
- Primary nav (`.primary-nav`, the `Home / Algo / Inbox / Chat / Search / Feeds / Login` row): add
  an `RSS` entry pointing at `/rss`, using the same `routerLink` + `routerLinkActive="active"`
  pattern as the existing entries. This is new top-level real estate, not a menu row — the epic
  overview calls `/rss` "a new central reading page," which means primary nav, not buried in More.

## 1c. `/rss` route skeleton

New page, own component (not a filtered view of `Lists`) — `pages/rss/rss-page.ts` or similar.
Sprint 1 scope is deliberately thin:

- Route `path: 'rss'`, lazy-loaded like every other page in `app.routes.ts`.
- Lists all enabled subscriptions from `RssSubscriptions.feeds` (already a signal — no new store).
  Row = title, host (`rssHost` helper already exists in `lists.ts`, worth promoting to a shared
  util if this page needs it too), item count if known.
- **"Add a feed" button** opens a dialog: paste an RSS/Atom URL, validate + fetch via
  `RssFetch.fetchFeed` (existing service), subscribe via `RssSubscriptions.add` on success. This is
  the same logic `SettingsRss.attemptAdd` already implements — extract it to a shared place both
  the settings page and this dialog can call, rather than duplicating the fetch/error/retry-via-
  proxy flow.
- No read/unread, no headlines/article toggle, no All/Starred filter yet — those are Sprint 2.
  Clicking a feed row for now can route to the existing per-feed profile/timeline view if one
  exists, or just expand inline; whichever is less new code, since it's getting replaced by the
  headline/article view next sprint anyway.

## 1d. Home/RSS un-mixing: auto-classification

`RssProvider` (`providers/rss/rss-provider.ts`) currently blends every enabled feed's items into
Home. Add a per-feed eligibility check before a feed's items are included in `fetchPage()`'s
output:

- **Signal to measure**: post frequency and item body length, observed from feeds already being
  fetched (RSS items reaching Home *are* the fetches already happening — no new network cost).
- **Where to store the running classification**: extend `RssFeedSub` (in `rss-subscriptions.ts`)
  with a derived/cached field the same way `itemCount` is already opportunistically recorded via
  `recordFetch` — e.g. track recent-item timestamps or a rolling frequency estimate, recomputed
  each fetch, no separate store.
- **Threshold**: needs a concrete number before this ships — e.g. "≥2 items published in the last
  24h AND median item body <280 chars (or however Status bodies are measured elsewhere in the
  codebase — check `feedToStatuses` for how RSS item bodies are currently truncated/rendered)
  qualifies for Home." Pick numbers, note them in code with a comment on *why* those numbers (same
  as `RSS_SUBSCRIPTION_LIMIT`'s comment explaining "ten is a recommendation"), and expect to tune
  after real feeds are tested against it.
- Feeds that don't qualify are simply excluded from `RssProvider.fetchPage()`'s Home output but
  remain fully present on `/rss` — no subscription-level change, purely a filter at the Home
  read path.

## Out of scope for Sprint 1

Read/unread, starred, headline/article modes, search-based discovery, starter kits, comments,
share-to-Mastodon, friend-link extraction. All Sprint 2/3/later per [[rss-0-overview]].

## Test/verify notes

- Runtime verification per `.claude/skills/verify` — SPA at `/_ui/`, Playwright selectors need that
  prefix.
- New localStorage/derived fields on `RssFeedSub` need a `storage-registry.ts` classification or
  `make storage` fails (see [[project-mimb-observability]]).
- Watch for the interceptor-order trap if any new Home-path RSS code touches `HttpClient` headers
  (see [[project-mimb-observability]]) — unlikely to apply here since `RssFetch` likely uses
  `fetch()` directly like other raw-fetch RSS code, but verify before assuming.
