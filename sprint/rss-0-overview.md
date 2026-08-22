# RSS — Epic overview: the reading page

Status: PLANNED (written 2026-08-22)

Builds on the existing RSS foundation: `RssSubscriptions`, `RssFetch`, `RssCache`, `RssProvider`,
OPML import/export, and per-feed CORS-proxy opt-in all already exist and work
(`providers/rss/*`, `pages/settings/rss/`). This epic does not rebuild any of that — it gives RSS
its own reading surface, and fixes the nav that currently has no room for it.
Also draws on [[project-mimb-readability]] (client-side article extraction, `PreviewCard`) for the
article view in Sprint 3.

## Product premise

**RSS today is a guest in someone else's house, twice over.**

1. On the Feeds page (`/feeds`, `pages/lists/lists.ts`), RSS is one of sixteen sections stacked in
   a single scroll behind a flat dropdown picker. Every kind of feed — Lists, Tag bundles, Bluesky
   pinned/feeds/lists/popular, Collections, Endorsements, Twitter, RSS — gets the same one-line
   picker option and the same wall-of-rows treatment underneath. Finding "the Bluesky feed I
   starred" today means: open the page, scan or pick from a 16-item dropdown, then scroll a stack
   of unrelated section headers to find the one that rendered. That's the "wall of text" and
   "airplane dashboard" the boss is describing.
2. On Home, `RssProvider` is registered in `provider-registry.ts` and blends every enabled RSS
   item into the same feed as posts/boots/replies. A five-times-a-day 2000-word news article and a
   friend's one-line status share a rendering slot and a scroll. Different reading posture, same
   pixel — it mixes poorly because it *is* poorly mixed.

**The fix is two different moves, not one:**

- **Navigation**: turn the flat picker into a drill-down. Land on a short list of ~20 category
  rows (counts fill in async, never blocking the initial paint). Click a category, see only that
  category's feeds. Getting to "Bluesky → Top hits" is three clicks (Feeds → Bluesky → the feed),
  never a scroll past things you didn't ask for. `/feeds` (the "All" view) stays reachable for
  anyone who wants the current everything-at-once page.
- **Reading surface**: RSS gets its own page (`/rss`) with a reading posture Home doesn't have —
  read/unread, headlines vs. article view, starred, long-article pagination — instead of trying to
  make Home's card-per-status model do double duty.

**Home keeps a narrow slice of RSS**, not none: feeds that behave like a social timeline —
posting multiple times a day, short body text — are the one case where mixing is *correct*, because
they read like short-form posts, not articles. Long-form/low-frequency feeds (the common case:
newsletters, blogs, daily-or-less news sites) are excluded from Home and live only on `/rss`. See
Sprint 1's classification heuristic.

## Menu pressure this epic resolves

The `…More` menu (`shell/shell.html`) is out of room. Four rows move or disappear as this epic
lands:

| Row | Today | After this epic |
| --- | --- | --- |
| Lists | `…More` → `/feeds/lists` | Feeds landing page (drill-down category) |
| Tags | `…More` → `/feeds/tags` | Feeds landing page (drill-down category) |
| RSS feeds | `…More` → `/settings/rss` | Stays as *feed management* (add/remove/OPML/proxy); `/rss` (new, primary nav) becomes the *reading* surface. Both exist — settings is config, `/rss` is where you read. |
| Storage Diagnostics | `…More` → `/storage-diagnostics` | Own primary-nav-adjacent home (exact placement decided in Sprint 1 alongside the Feeds nav work — same PR touches the menu, so both moves land together) |

Lists and Tags already redirect from bare `/lists` and `/tags` (back-compat routes exist) — no
route changes needed there, only where the menu points and how the destination page presents
itself.

## Sprint sequence (this doc covers 1–3; the roadmap continues past it)

1. **Sprint 1 — Feeds nav rework + `/rss` page skeleton + Home/RSS un-mixing.** Drill-down category
   list with async counts on `/feeds`. New `/rss` route with "All feeds" list, "Add a feed" dialog.
   Menu rows move. Auto-classification heuristic ships so Home stops showing article-length feeds.
2. **Sprint 2 — Read/unread + filters + headline view.** localStorage read-state store. All/Starred
   filter. Headlines (condensed) vs. article (expanded) list modes. Mark-all-read. Scroll-tracking
   setting.
3. **Sprint 3 — Starter kit + friend-link extraction + article view reuse.** First starter kit (5
   news links). Extract RSS/Atom feed references from links posted by people you follow. Article
   view on `/rss` reuses the Sprint reader-1 extraction pipeline (`ArticleFetch`) instead of
   building a second one.

**Deferred past Sprint 3** (explicitly out of scope until re-planned): in-app feed discovery via
site-HTML link-rel scraping (Sprint 3 ships only the external-search-tab version; the
scrape-the-page version reuses `article` route plumbing but needs its own design pass), RSS
comments, share-to-Mastodon-with-highlight, "friends shared items" synthetic feed, feed folders,
90-day read-state wipe, reader harmonization across long-post/tweet-storm/RSS-article (explicitly
named as *not now* by the boss).

## Why RSS gets primary nav and the other ~15 feed kinds don't (2026-08-22)

Lists, tags, tag bundles, collections, endorsements, Twitter, four flavors of Bluesky feed — the
Feeds hub has 15-20 kinds of feed by now, all sharing similar UI, and history here is that giving
each one its own top-level nav slot doesn't scale (that's exactly the clutter this epic's Sprint 1
fixed). RSS is the deliberate exception, not a precedent for un-collapsing the rest: it is a
Mawkingbird Plus feature, and a paid feature earns the prominence a `…More` row or a Feeds-hub
category can't give it. The other feed kinds stay inside the Feeds drill-down.

## Design decisions settled with the boss (2026-08-22)

- **Feeds nav is a drill-down list, not an accordion and not the current dropdown-plus-scroll.**
  Category rows (~20, counts async) → click → that category's feeds only. Goal: any destination
  reachable in 3 clicks, zero scrolling past unrelated sections.
- **Home keeps some RSS, not zero.** Auto-detected "chatty" feeds (high frequency, short items)
  blend into Home like today; everything else is `/rss`-only. Auto-detection, not a manual toggle —
  no per-feed setting to maintain, no onboarding step nobody will find.
- **Read tracking is `localStorage`, scoped like `RssSubscriptions`** (see `account-scope.ts`'s
  `scopedKey`), keyed by feed URL + item id. Not IndexedDB (`RssCache`'s territory) — read state is
  small, flat, and synchronous-write like every other Mockingbird preference.
- **Feed discovery is two features, both roadmapped, both simple**: (a) a button that opens an
  external search engine in a new tab (zero backend, ships Sprint 3), and (b) paste a *site* URL
  (not a feed URL) and reuse the existing article-fetch machinery to pull the HTML and find
  `<link rel=alternate>` feed references client-side. (b) needs its own sizing — not committed to a
  sprint number yet.
- **Article view reuses the readability pipeline**, not a second extractor. One extraction path,
  two entry points (reader-mode expansion, `/rss` article view).
