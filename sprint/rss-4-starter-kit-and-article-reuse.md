# RSS Sprint 4 — Starter kit, friend-link extraction, article-view reuse

Status: PLANNED
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

## 4a. First RSS starter kit: 5 news links

- Reuses the existing starter-kit pattern — check `bundled-starter-kits` (`pages/bundled-
  starter-kits/`) for the current shape of a starter kit (it already exists for account-follow
  kits per the epic overview's "Find Friends hub" mention in `shell.html`'s menu comments). Model
  the RSS kit the same way rather than inventing a new "kit" concept.
- Content: 5 hand-picked, well-known, low-friction RSS/Atom feed URLs (the boss said "5 news
  links" — needs the actual 5 URLs picked before this ships; not a planning-doc decision, flag for
  the boss when this sprint starts).
- Entry point: offered from `/rss` when the subscription list is empty (the natural
  empty-state, matching `showStarterCollection`'s pattern in `lists.ts` for the existing list
  starter-collection empty state) and/or from the Find Friends hub if that's where other starter
  kits surface today — check `bundled-starter-kits` usage sites before picking one over the other;
  likely both.
- One-click subscribe-to-all, using `RssSubscriptions.adoptAll` (already built for exactly this:
  bulk-adopt while preserving any existing per-feed flags) rather than looping `add`.

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
