# Search overhaul — grounded plan & sprint index

This is the codebase-grounded version of `spec/search/better_search.md`. The consultant
wrote that spec without access to the app; this document reconciles it with what
Mawkingbird actually has and splits delivery into four sprints.

## What the consultant didn't know we already have

- **Anonymous post search already works** the way §4.4/§17 describes: `AnonymousPublicApi.searchPostsByHashtags()`
  turns words into hashtags, fetches one public tag timeline per word (capped at 10 via
  `ANONYMOUS_POST_SEARCH_TAG_LIMIT`), dedups by URL, sorts by date. The transformation the
  spec wants is built — it just isn't *explained* to the user yet.
- **Authenticated search** is `Api.search(q, type, {resolve, limit})` → `GET /api/v2/search`,
  with `resolve=true` auto-applied for handle/URL-shaped account queries.
- **A date-operator advanced panel** already composes `before:`/`after:`/`during:` into the
  query box (`search.ts applyAdvanced()`) — a partial §6.3 + §8.
- **URL-driven search** (`?q=&type=`) restores/re-runs on navigation — the foothold for §16.
- **Trends as idle state** (`trendingStatuses` / `trendingTags`).
- **Account-scoped localStorage** via `scopedKey()` + `ClientPrefs` — the home for saved searches.

## The one hard architectural constraint (already how we live)

The spec's §23 three-category rule — *sent to Mastodon* / *applied to loaded results* /
*unsupported* — is exactly the anonymous-vs-authenticated split Mawkingbird already enforces
through `AnonymousCapabilities`. Anonymous = almost everything is a loaded-result filter
(mastodon.social nerfs anonymous full-text search — see the `mastodon.social anonymous
endpoints` memory). Authenticated = criteria can be sent to the server. Every sprint below
must keep category-2 (client filter) visually honest and never fake it as category-1.

## Decisions taken (from Matthew, 2026-07-20)

1. **Trust the consultant on the search DSL.** We will emit `from:`, `has:media`, `-is:reply`,
   `language:`, `in:public`, `before/after/during` as the consultant claims the docs support
   them. No live spike. **Risk accepted:** if mastodon.social ignores an operator, results are
   silently *broader* than the chips claim. Mitigation: the serializer's unit tests are the
   contract, and the **Explain panel ships alongside the serializer** so the user can always
   see what was actually sent vs. filtered locally. If reality bites, we re-point the tests.
2. **No `SearchExecutionPlan` object.** The consultant over-modeled this. In our codebase every
   search path is a fixed shape — there is no way to construct unbounded fan-out. Budgeting
   collapses to **a request counter + a ceiling**:
   - authenticated: `pages == API calls` (1 per page), exactly as expected.
   - anonymous post search: page 1 is *N* parallel calls (one per tag word, already capped at
     10); "load more" is another N. This is the only place pages ≠ calls, so "Load more" must
     know its cost is N and refuse when the budget can't cover it.
   Display strings only (`"2 of 3 API calls used"`), no pre-flight plan preview.
3. **Adopt `MawkingbirdSearch` as the single source of truth.** Form ⇄ URL ⇄ saved-search all
   read/write the rich object (§5). Enables clean share-links and saved-search migration.

## Sprints

| # | File | Theme | API risk |
|---|------|-------|----------|
| 1 | `search-1-rich-object-and-refine.md` | `MawkingbirdSearch` model + client-side refinement layer (chips, loaded-result filter, facets, grouping) | none — pure client over current results |
| 2 | `search-2-serializer-and-explain.md` | `MastodonQuerySerializer` + advanced post form + anonymous-transform explanation + Explain panel | DSL trust risk lives here; contained by unit tests + Explain |
| 3 | `search-3-budget-and-pagination.md` | Max-API-calls selector, request counter/ceiling, budget-capped "Load more", execution status line | none new — counting existing calls |
| 4 | `search-4-saved-and-shareable.md` | Saved searches (account-scoped localStorage) + shareable URL encoding of the rich object | none |

Sprints 1→4 are ordered so each ships something visible and the risky DSL work (2) is
insulated by the Explain panel it ships with. 3 and 4 are independent of each other once 1+2
land.

## Files that will change (map for all sprints)

- `ui/src/app/pages/search/search.ts` / `.html` / `.css` — the page (all sprints).
- `ui/src/app/providers/anonymous/anonymous-public-api.ts` — `searchPostsByHashtags` gains
  budget-awareness (sprint 3) and returns tag-transform info for Explain (sprint 2).
- `ui/src/app/api.ts` — `search()` gains a `limit`/paging surface if needed (sprint 3).
- **New:** `ui/src/app/pages/search/mawkingbird-search.ts` (model + defaults, sprint 1).
- **New:** `ui/src/app/pages/search/mastodon-query-serializer.ts` (+ `.spec.ts`, sprint 2).
- **New:** `ui/src/app/pages/search/search-refine.ts` (facet/filter/group helpers, sprint 1).
- **New:** `ui/src/app/pages/search/saved-searches.ts` (sprint 4, uses `scopedKey`).

## Testing

Specs run only via `npm run test:ci` (see `UI test runner` memory — raw vitest fails, no
targeted runs). The serializer (sprint 2) and refinement helpers (sprint 1) are pure
functions — cover them heavily there since the page component itself is thin.
