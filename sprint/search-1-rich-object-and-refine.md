# Sprint 1 — Rich search object + client-side refinement layer

**Goal:** introduce `MawkingbirdSearch` as the source of truth, and build the pure
client-side refinement layer over the results we *already* fetch: active-filter chips,
loaded-result text filter, facets, and grouping. Zero new API surface — this works
identically anonymous and authenticated, and is the lowest-risk, highest-visibility win.

Covers spec §5, §10, §11, §12, §13.

## Why this goes first

Everything here operates on the `SearchResults` the current `fetch()` already returns. Our
`Status` model carries every field the facets need — `language`, `media_attachments`,
`sensitive`, `in_reply_to_id`, `poll`, `account.acct`/`bot`/`locked`. Nothing depends on the
DSL trust bet (sprint 2) or budgeting (sprint 3), so it can ship on its own.

## Deliverables

### 1. `MawkingbirdSearch` model — `pages/search/mawkingbird-search.ts` (new)
- Port the `MawkingbirdSearch`, `PostSearchCriteria`, `AccountSearchCriteria`,
  `HashtagSearchCriteria`, `SearchPresentation` interfaces from spec §5 verbatim (they're the
  contract for sprints 2/4). Include `version: 1`.
- Export `emptySearch(target): MawkingbirdSearch` factory with spec defaults
  (`apiCallBudget: 3` — but budget is inert until sprint 3; `presentation.grouping: 'none'`).
- The search page's existing `query`/`type` signals become **derived from / written into**
  this object. Keep the plain search box wired to `post.words` (or `account.text` /
  `hashtag.text`) so nothing regresses.

### 2. Refinement helpers — `pages/search/search-refine.ts` (new, pure functions, well-tested)
- `activeChips(search): Chip[]` — every non-default criterion → a removable chip, each tagged
  `origin: 'server' | 'loaded'` so the UI can visually distinguish them (§10: hover text / small
  icon, **not** two separate UI systems). In sprint 1 almost everything is `'loaded'`; sprint 2
  flips post criteria to `'server'` when authenticated.
- `filterLoaded(statuses, text): Status[]` — §12 substring match over rendered plain text
  (strip HTML from `content`), plus `spoiler_text`, `account.display_name`/`acct`, hashtags.
  Runs on every keystroke, no API call.
- `buildFacets(statuses): Facet[]` — §11 facets derived only from loaded results:
  language, author, media-type (from `media_attachments[].type`), reply-vs-original
  (`in_reply_to_id`), sensitive, and account domain (parse from `acct`). Counts = "loaded
  results matching this value." Cap 5 values, "Show more" from already-loaded data only (§11.2).
  **Never** an API call to populate a facet.
- `groupResults(statuses, grouping): Group[]` — §13 `none` (preserve server order) /
  `author` (account headers) / `date` (Today / Yesterday / dated / Earlier, local calendar).

### 3. Search page wiring — `search.ts` / `.html`
- Below results: chip row → `Refine loaded results` (collapsible facets, "Based on N loaded
  posts") → `Filter these results` box → `Group by [None|Author|Date]`.
- Removing a `'loaded'` chip / facet updates results immediately (no API). Removing a
  `'server'` chip is inert this sprint (offers "Run updated search" in sprint 2).
- Status line: `Showing X of Y loaded posts` (§12). The `N of M API calls used` half comes in
  sprint 3.

## Layout: go wide (facets need the room)

Matthew's call, and the codebase makes it a one-liner. Once facets are visible the single
column between the rails is too tight. The shell already supports a rails-off wide mode:

- `shell.ts isWideUrl()` returns true for `/settings` and `/conversations`; those routes get
  `layout-wide` (`grid-template-columns: minmax(0, 1fr)`, no rails, `width: min(1460px, 100%)`).
- **Add `/search` to `isWideUrl()`** — that alone drops both rails for the search page.
- Then model the search page on chat's two-box grid (`pages/conversations/conversations.css`
  `.chat-page { grid-template-columns: 320px minmax(0, 1fr) }`, bordered rounded boxes,
  collapses to one column under `max-width: 800px`). Proposed:
  **left box = search form + facets + saved searches; right box = results.** This puts facets
  in their own scrollable rail instead of stacked below results.
- Keep it responsive: single column on narrow, exactly like `.chat-page`'s media query.

Do the `isWideUrl` change + two-box shell early in this sprint so facets have somewhere to live.

**Status: DONE.** `/search` added to `isWideUrl` (rails off). `.search-page` grid goes two-box
(`340px minmax(0,1fr)`) only for post results — form+facets left (sticky), results right —
and stays single-box for accounts/hashtags/idle states; collapses to one column at 800px.
Verified at runtime.

## Explicitly deferred
- Any operator emission / advanced form → sprint 2.
- "Apply to new search" from a facet (§11.1) → needs the serializer, sprint 2.
- Budget counting → sprint 3.

## Acceptance
- Search posts (auth **and** anonymous), get results, then: type in the filter box → count
  updates live; open facets → counts match loaded set; pick a language facet → list narrows
  with no network call; switch grouping → headers appear; remove a chip → updates immediately.
- `search-refine.spec.ts` covers `filterLoaded`, `buildFacets` counts, and date grouping
  buckets against fixture statuses. Run with `npm run test:ci`.
- No regression to existing account/hashtag/post search or trends idle state.
