# RSS Sprint 2 — The split-pane reader shell

Status: DONE (shipped 2026-08-22; rewritten same day — see "Why this sprint was rewritten" below)
Depends on: [[rss-1-nav-and-page-skeleton]]

## Why this sprint was rewritten

The original Sprint 2 (still in git history) planned read/unread + starring + a headline/article
*toggle* on top of Sprint 1's flat `/rss` list — a single column that switches view modes. On
2026-08-22 the boss clarified the actual target: **two distinct RSS experiences**, not one page with
a mode switch.

1. **Twitter-like** — the existing per-feed profile page (`/accounts/rss:<url>`, `pages/profile/
   profile.ts`'s `loadRss()`) and per-item thread/reader view (already built, Sprint 1). Reached by
   clicking an RSS item wherever it appears in the social surfaces — Home (for chatty feeds that
   qualify, see `rss-home-eligibility.ts`), a friend's boost, search. **This already exists and is
   not touched by this sprint.**
2. **Google-Reader-like** — `/rss` itself, redesigned as a full-screen split pane: left rail is the
   categorized feed list, right pane is content. This sprint builds that shell.

**Explicit boundary the boss drew**: an RSS feed that is chatty enough to blend into Home (the
Sprint 1 classifier) must still be fully readable via the ordinary profile/thread pages when someone
clicks into it from Home — the split pane does not replace that path, it is a second, deliberate
destination reached only via its own top-level nav icon. And the left rail's *subscriber list* is
RSS-only for now: the boss named a "someday" extension where Home megatweets/tweetstorms could
appear in the same left rail, but was explicit that a person who "just posts shorts" would never
show up there — out of scope for this sprint, noted for the roadmap.

## Goal

Turn `/rss` from Sprint 1's flat list into a two-pane layout: a left rail of categorized
subscriptions (reusing the drill-down concept from Sprint 1's Feeds page, scoped to RSS-only
categories), and a right pane that renders content in place — clicking a feed never navigates away
from `/rss`. This sprint is the shell and navigation model only; read/unread, starring, and the
headline/article distinction move to Sprint 3 (renumbered — see [[rss-3-read-tracking-and-filters]],
formerly the split-pane's read-tracking content, itself renumbered from the old Sprint 2). The
starter-kit/friend-link/article-reuse work that used to be Sprint 3 is now Sprint 4
([[rss-4-starter-kit-and-article-reuse]]).

## What "categorized" means (settled 2026-08-22)

The sprint's blocking open question. Resolved: **OPML folders, minimal model.**

Three things in this codebase are called "category" and only one of them is the user's own
organisation of their own subscriptions:

| Source | Granularity | Status today | Suitable for the rail? |
| --- | --- | --- | --- |
| OPML `<outline>` nesting | one folder per **feed** | parsed into `OpmlFeed.folders`, then **discarded** | **Yes** — this is the rail |
| RSS/Atom `<category>` on an **item** | one feed → many groups | parsed, rendered as a `#tag` line by `rss-adapter.ts` | No — churns every fetch, and a feed lands in many groups at once |
| RSS/Atom `<category>` on the **channel/feed** | one feed → many labels | **not parsed at all** (`ParsedFeed` has only `title`/`link`/`items`) | No — publisher-assigned, not the user's organisation |

Decisions:

- **OPML is the only source of folders.** `opml.ts` already walks the tree and records the path on
  each feed, with a comment saying it does so precisely because throwing it away loses information
  the file will not have again. Sprint 2 is where that stops being true.
- **A feed subscribed by URL is unfiled, by design.** RSS and Atom documents are uncategorized by
  default as far as this rail is concerned — confirmed with the boss. Channel-level `<category>` is
  *not* promoted to a folder even though the formats allow it: those labels are the publisher's
  topic taxonomy, not a statement about how this reader wants their list arranged, and silently
  filing someone's new subscription under a label they never chose is worse than leaving it in
  "Unsorted" where they can see it and move it.
- **Minimal model, not the full shared primitive.** `RssFeedSub` gains `folder?: string`. Nested
  OPML paths are joined with `" / "` (`Tech / Rust`), so the string *is* the display name and there
  is no id/rename/reorder machinery to build. `spec/ui/folders_for_all.md` §2's `Folder{id, name,
  parentId, position}` module stays a proposal; this is deliberately migratable to it later (the
  folder name is the natural join key) but does not build it, because that spec also covers
  bookmarks and is a feature in its own right, not a line item inside a layout sprint.
- **Export round-trips.** `buildOpml` gains a folder-aware branch so a list organised here survives
  an export/import cycle. The flat path stays for users with no folders.
- **Folders organise the rail; they do not filter Home.** Straight from the spec's §3 — the merged
  Home timeline is unaffected by folder assignment.

## 2a. Layout shell

- `/rss` becomes a two-column layout, full-width like `/search` and `/write` (check `shell.ts`'s
  `isWideUrl()` — `/rss` needs adding to that list so the rails don't compete with the pane split).
  Rough proportions per the boss's own comparison to the chat page: a narrower left rail, a wider
  right pane — check `pages/conversations/conversations.html`'s existing split-pane CSS
  (`conversations.css`) for the grid/flex pattern already solved there rather than inventing a new
  one; it's the closest existing analog in this codebase (list on the left, active thread on the
  right, same "nothing selected" empty state problem).
- **Left rail**: subscriptions grouped by **OPML folder**, reusing `RssSubscriptions.feeds` (no new
  store). See "What 'categorized' means" below — this was the sprint's open question and is now
  settled.
- **Right pane**: empty state ("choose a feed") until something is selected; feed selection is
  reflected in the URL (`/rss?feed=<url>`) so it's linkable and survives a reload, mirroring the
  `?section=` pattern Sprint 1 already established on `/feeds`.

## 2b. Feed click → right pane content

- Clicking one feed in the left rail loads that feed's items into the right pane **in place** —
  `RssProvider.getFeed(feedUrl)` already returns exactly `{ account, statuses }`, the same call
  `profile.ts`'s `loadRss()` makes for the full-page profile view. Reuse it directly; do not
  duplicate the fetch.
- Render items with `app-status-card`, the same component `profile.html` already uses for this list
  — the right pane is visually a narrower version of the existing profile list, not a new renderer.
- `/accounts/rss:<url>` (the full-page profile) and per-item thread/reader routes are **untouched**
  and keep working exactly as today — this is the explicit "still see it in the old profile/thread
  view" requirement. Nothing in this sprint changes `profile.ts` or `thread.ts`.

## 2c. Category click → merged right pane content

- Clicking a category (not a single feed) shows the **merged item list for every feed in that
  category**, newest-first — confirmed with the boss as the Google-Reader folder-click behavior,
  not an accordion-only expand. This needs a new aggregation path: `RssProvider` has no "get items
  for N feeds merged" method today (`fetchPage()` is Home-specific and already filters through the
  chatty-feed classifier, which is wrong here — a category view must show everything regardless of
  Home eligibility). Add a method (or a page-level helper) that calls `getFeed()` per feed in the
  category and merges+sorts the results — bounded by however many feeds are actually in the
  category, so no new cap logic is needed beyond what `PER_FEED_ITEM_CAP` already does per feed.

## 2d. "All feeds" stays as an entry point

- Sprint 1's flat list (every subscription, "Add a feed" button) does not disappear — it is the
  natural **empty-left-rail-selection default state** of the new `/rss`, or a dedicated "All" row at
  the top of the left rail (mirroring the Feeds landing page's own "All feeds" row) whose click
  merges every subscription into the right pane. Whichever reads more like Google Reader's "All
  items" — pick during implementation, not a planning-time decision.

## Out of scope for Sprint 2

Read/unread, starring, All/Starred filter, scroll-tracking, mark-all-read, headlines-vs-article
toggle — all moved to the renumbered Sprint 3. Starter kit, friend-link extraction, long-article
pagination, full readability-pipeline reuse — Sprint 4.

Folders are now *in* scope, but only in the minimal form described above. Explicitly **not** in this
sprint: the shared `folders/folders.ts` primitive, folder ids surviving renames, drag-reorder,
collapsed-state persistence, bookmark folders, and Raindrop collection seeding — all of
`spec/ui/folders_for_all.md` beyond "a feed knows its folder name". Also not here: filtering the
merged Home timeline by folder (§3 of that spec is explicit that folders organise the subscription
list only), and item-`<category>` tag filtering in the right pane (closer to Sprint 3's filter row
if it's wanted at all).

## Open questions to resolve before/during implementation

- ~~**What does "categorized" mean for the left rail?**~~ **Settled 2026-08-22** — OPML folders,
  minimal `folder?: string` model. See "What 'categorized' means" above.
- ~~**Left-rail proportions and responsive behavior**~~ **Settled during implementation.** 300px
  rail / fluid pane, capped at 1100px like `/conversations`. But the page deliberately does *not*
  copy that page's viewport-height grid: a transcript is bounded and wants its own scroller, an
  article is not, and boxing one in a fixed-height pane produced two nested scrollbars and a reading
  column cut off above the fold (seen in the first runtime pass). The page scrolls normally and the
  rail is `position: sticky` instead. Under 800px the rail unsticks and stacks above the pane — no
  toggle button, unlike `/conversations`, because a subscription list is short.
- ~~**"All feeds" as default state vs. explicit row**~~ **Settled: both.** "All items" is an
  explicit row at the top of the rail *and* the default selection when the URL names nothing. An
  empty "choose a feed" pane would make a reader that opened to read look like it failed to load.

## Test/verify notes

- Runtime verification per `.claude/skills/verify` — this is the first RSS page with real two-pane
  layout logic (URL-driven pane state), so Playwright coverage should include: selecting a feed
  updates the URL and the right pane; reloading on `/rss?feed=<url>` restores the same state;
  selecting a category shows a merged list; deep-linking to `/accounts/rss:<url>` and a thread route
  still work unchanged.

## What shipped (2026-08-22)

Verified at runtime against a production build (see `.claude/skills/verify`), driving Playwright
over three local CORS-enabled feeds:

- **Model** — `RssFeedSub.folder?: string`, `folderPathToName()` (3-level cap, tail folded with an
  em dash), `RssSubscriptions.folders` / `setFolder` / `renameFolder`. `adoptAll` preserves folders.
- **OPML** — import files feeds into their folder instead of discarding the path; `buildOpml` nests
  filed feeds under a folder outline. Verified lossless: a nested `Tech > Rust` file imported as
  `Tech / Rust`, exported back as a folder outline, and re-imported to the same structure.
- **Aggregation** — `RssProvider.getFeeds()`, tolerating per-feed failure and reporting which feeds
  failed. Deliberately *not* `fetchPage()`, which filters through the Home-eligibility classifier
  and would return nothing for a folder of newsletters.
- **Page** — `/rss` is the split pane. Rail groups unfiled-first then folders (case-insensitive
  sort); pane state lives in `?feed=` / `?folder=` / `?unfiled=1` and is restored on reload.
  `/rss` added to `isWideUrl()`.
- **Untouched, as promised** — `/accounts/rss:<url>` and the thread routes. Confirmed by clicking
  the pane's own "Open as profile" through to a working 5-card profile page.

Runtime numbers from the verification run: All items 22 cards, `?folder=Tech` 10 (only that
folder's two feeds), single feed 5, reload on the deep link 5.

Tests: 175 pass across the RSS provider/page/settings/shell specs. Two notes:

- `rss-page.spec.ts` stubs `app-status-card` — the real card drags in `NgOptimizedImage`, which
  throws in dev mode on the RSS adapter's `data:` avatar. Pre-existing, invisible in production,
  now written up in `bugs/mastodon_mock/bugs.md`.
- `npm run check:static` fails on `starter-kits:check`. Confirmed pre-existing on a clean tree —
  unrelated to this work.

