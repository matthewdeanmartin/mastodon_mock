# Sprint 3 — API-call budget + budget-capped pagination

**Goal:** give the user an explicit ceiling on how many requests a search may spend, count
real requests against it, cap "Load more" at the ceiling, and show the execution-status line.

Covers spec §7, §14, and the API-usage line of §9. **Explicitly rejects** the consultant's
`SearchExecutionPlan` object (see below).

## What we are NOT building (and why)

The spec §7.2 proposes a `SearchExecutionPlan` computed *before* submission that "rejects
designs requiring unbounded fan-out." **We are not building this.** In Mawkingbird there is no
way to construct unbounded fan-out — every search path is a fixed shape:

- **Authenticated** (`Api.search` → `/api/v2/search`): 1 call per page. `pages == API calls`.
- **Anonymous post search** (`searchPostsByHashtags`): page 1 `forkJoin`s *N* tag timelines
  (one per query word, already capped at 10 by `ANONYMOUS_POST_SEARCH_TAG_LIMIT`). "Load more"
  is another N. **This is the only place where pages ≠ calls.**

So budgeting reduces to **a counter and a ceiling**, owned by the search page. No pre-flight
plan object, no `warnings[]`, no plan preview UI.

## Deliverables

### 1. Max-API-calls selector — `search.html` + `MawkingbirdSearch.apiCallBudget`
- Dropdown labeled **"Maximum API calls"** (Matthew confirmed this label over "How many"):
  `1 Minimal / 3 Balanced (default) / 5 Thorough / 10 Maximum` (spec §7 table).
- Writes `apiCallBudget` on the rich object (already present from sprint 1, inert until now).

### 2. Request counter — small state in `search.ts` (or a tiny `SearchBudget` helper)
- `used` starts at 0 on each new search (a fresh `run()`), increments by the real number of
  HTTP requests each execution makes:
  - authenticated search / next page → +1,
  - anonymous page → +N (the tag count for this search).
- Reset semantics: a new search (§20 "Run search again" / changing criteria) resets `used`;
  "Load more" accumulates.

### 3. Budget-capped pagination — `search.ts` + provider paging surface
- Current code fetches a single page and has no "load more". Add paging:
  - `Api.search` already accepts `limit`; add `max_id` passthrough for authenticated paging
    (mirror `getTagTimeline`'s `max_id`).
  - `searchPostsByHashtags` needs to accept per-tag `max_id`s to fetch the next page of each
    tag timeline (it already maps over tags — thread a max-id map through).
- **"Load more" button** (§14 manual mode, the default): shown only when
  `used + nextPageCost <= budget`. `nextPageCost` = 1 authenticated, N anonymous. Label:
  `Load more — K calls remaining` / for anonymous, make the N cost explicit so a budget of 3
  with 4 tags correctly refuses the next page.
- §14 budget-fill auto mode (checkbox, off by default) is **optional** this sprint; ship the
  toggle only if manual mode is solid.

### 4. Execution-status line — `search.html`
- §7.1: `2 of up to 3 API calls used`, `80 posts loaded`, `18 posts shown after filters`
  (the last reuses sprint 1's `filterLoaded` count).
- §19 budget-exhausted state when `used == budget` and more pages likely exist.
- Fill the API-usage section the Explain panel stubbed in sprint 2 (`Maximum: N`, `Used: M`).

## Anonymous nuance to get right
A budget of 3 with a 4-word query cannot even complete page 1 (page 1 costs 4). Decide and
document the rule: **cap the tag count to the budget** (search fewer tags, note it in Explain)
rather than exceeding the budget — the spec's §7 "never silently exceed" is the hard rule.
Surface the truncation in Explain (§9 "truncated searches caused by the API-call budget").

## REVISED MODEL (2026-07-20, Matthew) — budget is eager, not manual

The consultant (and my first pass) had budget as a manual per-click ceiling. Matthew reframed
it correctly: **client-side facets can only refine what's loaded, so a search needs a real
corpus up front.** So the budget now means "fetch up to N large pages eagerly on Search":

- **Auto-fetch to budget on Search** — no opt-in checkbox. The number IS the instruction.
- **Page size = 40** (Mastodon max) for a fat corpus per call.
- **Defaults: 2 pages** for a plain search, **3** when the Advanced panel is opened.
- **Raising the budget after a search tops up** (5 after 3 → fetch 2 more pages).
- **"Load more" keeps paging past the budget**, one 40-post page at a time, up to a hard cap
  (30 calls) so it can't run away. `apiCallBudget` relaxed from a `1|3|5|10` union to `number`.
- **Bug fixed:** re-clicking Search with an unchanged query (or after only changing the budget)
  was a silent no-op, because navigating to identical query params emits no `queryParamMap`.
  `run()` now detects the identical case and fetches directly.
- **Clear** now also empties the main search box (it kept the stale serialized DSL before).

## Status: DONE (2026-07-20)

- Max-API-calls dropdown (1/3/5/10, default 3) writes `apiBudget`; shown for post search.
- Request counter `callsUsed` + `nextPageCost` (1 auth, N anon tags) + `canLoadMore` computed.
  New search resets counters/cursors; "Load more" accumulates.
- Paging: `Api.search` gained `offset` (Mastodon search pages by offset, not max_id — verified);
  `searchPostsByHashtags` gained `maxTags` cap + per-tag `maxIds`, and `hashtagsForQuery`.
- "Load more — K calls remaining" shown only when the next page fits the budget; else the
  budget-stopped message. Anonymous fan-out capped to budget; dropped tags surfaced in Explain.
- Explain now carries API-usage (Maximum / Used / Truncated) — filled the sprint-2 stub.
- Verified at runtime: budget=1 → no Load more + stopped msg; budget=5 → Load more with
  remaining count; Load more increments 1→2 of 3. Offset pagination confirmed on real
  mastodon.social (page 2 returns all-new ids). 923 UI tests pass.

Deferred (as planned): §14 auto budget-fill toggle — manual mode is solid; skipped this sprint.

## Acceptance
- Set budget to 1 → no "Load more" appears. Set to 5 → "Load more" appears with remaining
  count and stops at 5. Status line reflects real request counts, verified against the
  `/observability` API-metrics page (see `Observability page` memory) — counter should match
  actual HTTP calls made.
- Anonymous 4-word query with budget 3 → tag count capped, Explain notes the truncation, and
  the budget is never exceeded.
