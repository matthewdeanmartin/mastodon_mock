# RSS — Epic overview: the reading page

Status: Sprints 1-4 COMPLETE (2026-08-22). Second wave: Sprints 5-6 shipped 2026-08-23.

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

## Two RSS experiences, not one (clarified 2026-08-23)

Sprints 2-4 were re-planned once it became clear the epic actually needs **two distinct reading
surfaces**, not a single page with view-mode toggles:

1. **Twitter-like** — the per-feed profile page (`/accounts/rss:<url>`) and per-item thread/reader
   view. Already built (Sprint 1 wired reader-mode-by-default for RSS items; the profile page
   predates this epic). Reached whenever an RSS item surfaces in a social context: Home (for
   chatty/qualifying feeds), a click-through from anywhere else. **Untouched by Sprints 2-4** — this
   is the explicit guarantee that clicking an RSS item from Home always still works the old way.
2. **Google-Reader-like** — `/rss` itself, rebuilt as a full-screen split pane (left rail:
   categorized subscriptions; right pane: content, updated in place without navigating away).
   Reached only via its own top-level nav icon, never as a side effect of browsing Home. This is
   Sprint 2 ([[rss-2-split-pane-shell]]) onward.

The left rail's subscriber list is RSS-only for the sprints currently planned. A later, unplanned
extension the boss named explicitly: Home's own long-form posts (megatweets, tweet-storms) could
someday appear in the same left rail — but a feed/account that "just posts shorts" never would,
because those already have a home in surface (1). Not sized, not scheduled — noted here so it isn't
lost.

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

## Sprint sequence (updated 2026-08-23 — Sprint 1 shipped; 2-4 re-planned around the split pane)

1. **Sprint 1 — DONE.** Feeds nav rework (drill-down category list on `/feeds`), `/rss` page
   skeleton (flat list + "Add a feed"), Home/RSS un-mixing (chatty-feed auto-classifier). Plus two
   bug-fix passes landed the same day: automatic Plus-proxy adoption on a failed direct fetch, and
   RSS-aware reader-mode fixes (suppress/relabel "Fetch article" when the feed already gave the full
   body; hide the dead "Open in chat" control on read-only threads).
2. **Sprint 2 — DONE (2026-08-22).** [[rss-2-split-pane-shell]]. Rebuilds `/rss` into the two-pane
   Google-Reader layout: left rail (subscriptions grouped by OPML folder), right pane (content,
   updated in place). Feed click and folder click (merged list) both land in the right pane without
   leaving `/rss`. The "what does categorized mean" question is **settled** (2026-08-22): OPML
   folders, minimal `folder?: string` on `RssFeedSub` — import stops discarding the tree it already
   parses, export round-trips it, and a feed subscribed by bare URL is unfiled rather than being
   filed under a publisher's own `<category>` labels. Deferred-folders is therefore partly reopened,
   in the narrow form only; `spec/ui/folders_for_all.md`'s shared primitive remains a proposal.
3. **Sprint 3 — DONE (2026-08-22).** [[rss-3-read-tracking-and-filters]]. Read/unread store, starring,
   All/Starred filter, scroll-tracking, mark-all-read (scoped correctly to feed vs. category vs.
   all — flagged as the sprint's most embarrassing possible bug), and a headline-density row
   renderer for the right pane (a new lightweight component, not a repurposed `app-status-card`).
4. **Sprint 4 — DONE (2026-08-22).** [[rss-4-starter-kit-and-article-reuse]]. First starter kit (5 news
   links, URLs not yet chosen). Extract RSS/Atom feed references from links posted by people you
   follow. Long-form article view in the right pane reuses the reader-1 extraction pipeline
   (`ArticleFetch`) instead of building a second one; adds pagination on top of it.

5. **Sprint 5 — DONE (2026-08-23).** [[rss-5-paste-any-url]]. General feed discovery: one box that
   takes a site URL, a feed URL, a fediverse handle or a bare domain and works out what was meant.
   Removes the view-source step that gated every RSS feature behind being a developer — named by the
   boss as the top priority of the second wave ("my total addressable market for subs drops 99% as
   long as features like that exist"). A site declaring several feeds shows all of them with the
   best pre-picked; **a fediverse handle offers Follow first**, with RSS as a deliberately
   de-emphasised secondary option.

**Deferred past Sprint 6** (explicitly out of scope until re-planned): RSS comments (see below),
"friends shared items" synthetic feed, reader harmonization across long-post/tweet-storm/RSS-article
(explicitly named as *not now* by the boss, and reaffirmed 2026-08-23), Home megatweets/tweet-storms
appearing in the split pane's left rail (named as "someday," not scheduled).

6. **Sprint 6 — DONE (2026-08-23).** [[rss-6-share-any-ecosystem]]. One share dialog with two
   sections: **post it** through a configured connector, or **send it to** a destination via web
   intent — a destination appears in exactly one, decided per session. Highlight-to-quote included.
   Adds the `unified-share` flag (default off), which collapses Boost/Quote/Share into one menu and
   *frees* a slot on an action bar that was already wrapping.

**Planned next**: the 90-day read-state prune (client-side — read state lives only in
`localStorage`, so there is no server job to write).

### RSS comments — the options, for whenever this is picked up

Nothing in `spec/` covers this; the formats offer three routes, only one of which carries content:

| Option | What it gives | Verdict |
| --- | --- | --- |
| `<comments>` (RSS 2.0) | A URL to the comment *page* | Trivial, but it is only a link out |
| `slash:comments` | A comment *count* | Trivial; useful as a ranking/filter signal, no content |
| `wfw:commentRss` | A whole *second feed* of the comments | The only one with real content — and `RssFetch` already parses it, so it is the same code path rendered as a thread |

`wfw:commentRss` is the real answer. Note the hard limit both [[posse-0-overview]] and
[[hugo-0-overview]] already establish: **receiving** anything requires a listening server, which
this app will never be. So RSS comments are strictly read-only, and only where the publisher
chooses to publish them. Low value density; deferred rather than dropped.

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
  `<link rel=alternate>` feed references client-side. **(b) shipped in Sprint 5**, generalised well
  past a site URL: the same box also takes feed URLs, fediverse handles and bare domains.
- **A fediverse handle offers Follow, not RSS** (settled 2026-08-23, correcting Sprint 4a). Sprint
  4a noticed that any Mastodon `.rss` sends `ACAO: *` and treated needing no proxy as a reason to
  reach for it. That optimises our convenience, not the user's: following gets replies, boosts and
  notifications, where the feed gets public top-level posts in a reader. RSS stays available as a
  secondary option — high-volume accounts you want to read rather than follow, or accounts on a
  defederated server are real cases — but it must never be the default. As the boss put it: "stop
  over indexing on using RSS to subscribe to mastodon."
- **Article view reuses the readability pipeline**, not a second extractor. One extraction path,
  two entry points (reader-mode expansion, `/rss` article view).
