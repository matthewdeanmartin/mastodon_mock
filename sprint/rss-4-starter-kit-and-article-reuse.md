# RSS Sprint 4 — Starter kit, friend-link extraction, article-view reuse

Status: DONE — 4a shipped 2026-08-22; 4b and 4c shipped 2026-08-22. Epic complete.
Depends on: [[rss-3-read-tracking-and-filters]]

Renumbered 2026-08-23 from the original Sprint 3 — [[rss-2-split-pane-shell]] was inserted ahead of
it once the split-pane layout requirement was clarified. No content below changed as a result,
except references to "Sprint 2" and "/rss's Articles mode," which now mean
[[rss-3-read-tracking-and-filters]]'s headline-density work rather than the old single-column
toggle.

## Goal

Solve cold-start (nobody has RSS subscriptions on day one), grow subscriptions from social signal
already in the app (friends' links), and give `/rss` a real long-form reading view by reusing
already-built machinery instead of writing a second article extractor.

## 4a. RSS starter kits — DONE (2026-08-22)

Pulled forward ahead of Sprint 3 at the boss's request: "people are lazy and won't evaluate a
feature if they need to track down 20 rss feeds before they see the feature."

**Shipped**: four themed kits (World news 4, Tech 6, Science 4, Fediverse 4 = 18 feeds) in
`providers/rss/rss-starter-kits.ts`, installed by `RssStarterKitInstall`, offered by
`pages/rss/starter-kits/`. Each kit files its feeds into its own folder, so the Sprint 2 rail is
doing visible work from the first click.

Decisions that differ from what this doc originally assumed — all deliberate:

- **Hand-curated, not generated, and `check:static` never fetches them.** The doc said "reuse the
  existing starter-kit pattern". The account kits' pattern is a script that revalidates 132 live
  accounts in the quality gate, and that gate had been red for three weeks over one dead account
  (see `bugs/mastodon_mock/bugs.md`). That machinery exists to honour per-account opt-out flags
  (`discoverable`/`indexable`/`noindex`) — **RSS has no equivalent signal**, publishing a feed is
  the opt-in, so a network gate here buys nothing and costs flakiness. Feed list is plain reviewed
  data.
- **Not `adoptAll`.** The doc specified it. It is wrong here: it records subscriptions without
  proving any can be read. Each feed goes through `RssAddFeed` (validate-by-fetching) with the same
  direct→proxy fallback the manual add and OPML import use, so a subscription only exists once a
  fetch has worked, and `useProxy` is recorded only per feed that needed it.
- **CORS is a feed-selection criterion, not a footnote.** First draft was picked on editorial merit:
  only 4 of 19 feeds sent `Access-Control-Allow-Origin`, and a fresh install of the Fediverse kit
  subscribed **1 of 4** with three failures — the exact bad first impression kits exist to prevent.
  Rebuilt around CORS-readable feeds; now **16 of 18** work with no proxy at all, verified at
  runtime (Fediverse kit: 4/4, Science: 3/4 with Phys.org honestly reported).
  Useful trick: any Mastodon account's `.rss` sends `ACAO: *`, so a CORS-blocked publisher that also
  posts to the fediverse can be included via their account feed instead.
- **The subscription ceiling is surfaced, not hit silently.** Default limit is 10 and the kits total
  18, so installing two kits truncates. The panel disables kits that do not fit, says how many slots
  are left, and offers a one-click "Raise the limit to N". Verified at runtime.

Not built: a `/collections/starter`-style standalone kit page. The kits live in the `/rss` pane's
"All items" view, which is where a cold-start user already is.

## 4b. Friend-link RSS/Atom extraction

- Source: links already posted by accounts the user follows (statuses' `card`/link content —
  `PreviewCard` per [[project-mimb-readability]] notes that `Status.card` exists in `models.ts` and
  is currently unrendered/unused elsewhere in the app, which makes this its second consumer too).
- For a followed account's posted links, check whether the *site* (not the individual post URL) has
  an RSS/Atom feed — this is the client-side link-rel discovery mentioned in the epic overview
  (fetch the page via the existing article-fetch proxy path, parse for
  `<link rel="alternate" type="application/rss+xml">` or `atom+xml`). Reuse the `article` route
  plumbing from [[project-mimb-readability]] (`ArticleFetch`) for the fetch itself — do not build a
  second HTTP-fetch-through-proxy path.
- Surface: a "Feeds from people you follow" section, likely on `/rss`'s empty/discovery state
  alongside the starter kit (4a) — a suggested-feeds list the user can one-click subscribe from,
  not an automatic subscription. Nothing subscribes on the user's behalf; extraction only produces
  suggestions.
- Rate/scope limits: this is a per-request client-side fetch against arbitrary third-party sites,
  same cost profile as article-expansion fetches. Cap how many recent links get probed per session
  (mirror whatever throttling article-expansion already applies, if any — check `thread.ts`'s
  quota-spending pattern noted in [[project-mimb-readability]]) so this doesn't burn a free CORS
  proxy's quota silently in the background.

## 4c. Article view: reuse the readability pipeline

- The split pane's right-side rendering ([[rss-2-split-pane-shell]], densified in
  [[rss-3-read-tracking-and-filters]]'s 3d) gets real long-form reading: when an item is opened,
  call the same `ArticleFetch`/extraction path reader mode already uses
  (per [[project-mimb-readability]] — client-side extraction, `article-metadata.ts` as the
  load-bearing fallback, `PreviewCard` on failure) rather than writing an RSS-specific extractor.
- **Long-text pagination** ("split into pages," from the original list): this is new on top of the
  existing pipeline — reader-mode expansion today renders one long scroll (per the Sprint 1f
  outcome notes in `reader-1-article-expansion.md`, nothing there describes pagination). Scope this
  as an RSS-page-specific presentation layer over the same extracted content, not a change to the
  shared extraction service — the extractor still returns one document; pagination is purely how
  `/rss` chunks and displays it.
- **Bookmarks** (also in the original list, grouped with "split into pages"): check whether
  `pages/bookmarks/` already covers "save this for later" generically before building an
  RSS-specific bookmark concept — bookmarking an extracted article is plausibly just "bookmark this
  Status" using the existing bookmarks feature, since RSS items are already synthesized into
  `Status` objects (`feedToStatuses`). Confirm before treating this as new work.

## Out of scope for Sprint 4

In-app search-based discovery beyond the external-search-tab button (deep site-scraping discovery
beyond 4b's specific friend-link case stays deferred per the overview). Comments, share-to-
Mastodon, friends'-shared-items synthetic feed, folders, 90-day auto-wipe job, reader
harmonization across long-post/tweet-storm/RSS (explicitly "not now" per the boss).

## Test/verify notes

- 4b's site-fetch-and-parse path touches the CORS proxy same as article expansion — the
  `X-Proxy-Source`/`X-Proxy-Upstream-Status` header handling from [[project-mimb-readability]]
  applies here too if errors need to be distinguishable (proxy failure vs. site has no feed).
- Runtime verification per `.claude/skills/verify`, same conventions as prior sprints.

## 4b and 4c as built (2026-08-22)

### 4c — article view, reusing the readability pipeline

`pages/rss/rss-article/` calls `ArticleFetch.expand()` — the same call reader mode makes from the
thread view — and renders the returned markdown with `renderMarkdown()`. No second extractor, no
second cache, no second quality gate, exactly as the doc required.

Quota follows the rule `thread.ts` established, for the same reason: only the caller knows whether
an article was actually *rendered*, so `recordFetch` goes before the request and `consume` only
fires once `result.article` exists. A cache hit, a failure, and a page the quality gate rejected all
cost nothing.

Offered only where there is something to fetch: `articleTarget()` already returns null for an item
whose feed gave full content (`rssFullContent`), so a full-content item shows no button rather than
re-downloading text already on screen.

**Pagination** (`pages/rss/article-pages.ts`) is a pure presentation layer over the extracted
document — the extractor still returns one document, and this decides where a page break is offered.
~500 words a page, split only at block boundaries, fenced code kept whole (a blank line inside a
fence is not a paragraph break, and splitting there would leave an unterminated fence that swallows
the rest of the page), and a scrap of a final page folded back into the one before it. Articles
under 1.5 pages are not paginated at all.

Runtime: a teaser feed item fetched through the proxy, extracted 599 words as page 1 of 4, Next
advanced to page 2 with different content.

### 4b — friend-link feed discovery

`providers/rss/rss-discovery.ts`. Reads one page of the home timeline, reduces it to outbound links
with the existing `outboundLinks()` (so social navigation and non-http URLs are already filtered),
reduces *those* to site roots, fetches each root through `CorsProxy.proxyRequest()`, and reads
`<link rel="alternate">`.

Cost control was the design constraint, since every probe is a third-party fetch on the same shared
proxy budget article expansion draws on:

- **One probe per site, not per link.** Ten links to the same blog is one fetch, and attribution
  goes to whoever linked it first.
- **Ten sites per run, hard cap.**
- **Sequential**, like the OPML importer and kit installer — a burst is what a free proxy
  rate-limits.
- **Nothing runs in the background.** A run only ever happens because someone pressed the button.

Suggestions only: nothing subscribes on the user's behalf, and taking one goes through `RssAddFeed`
(direct, then proxy) rather than a bare subscription write, because a `<link rel=alternate>` is a
claim and this is where it gets checked. Already-subscribed feeds are not offered.

Runtime: found a feed on a linked site, attributed it to the account that posted the link, and Add
subscribed it and removed the suggestion.

Tests: 386 pass across RSS, thread and the whole article pipeline — the shared extraction path has
no regressions. `check:static` green.

