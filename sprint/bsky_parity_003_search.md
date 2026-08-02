# Sprint 3 — Search

Status: **3a DONE** (2026-08-01), 3b READY. Grounded in the lexicons and then
verified against the live API — see "Measured" below.

## 3a: what shipped

- `bluesky-post-search.ts` — `BlueskyPostSearch`, `parseTags`,
  `hasBlueskyFilters`, `describeBlueskyFilters`. Its own criteria object, not an
  extension of `MawkingbirdSearch`.
- `bluesky-api.ts` — `searchPosts(criteria, cursor)`, serializing each criterion
  to a typed param.
- `bluesky-search.ts` — `BlueskySearch`: one call per page, cursor paging,
  error messages a reader can act on.
- `bluesky-search-panel.ts/.html/.css` — a self-contained panel with Bluesky's
  own filters and its own results.
- `search.ts` / `search.html` — a `🦋 Bluesky posts` option that swaps the panel
  in. Gated on a linked account.

**Reuse, without switch statements.** The panel is a separate component and
`blueskyMode` is a separate flag from `SearchType` — deliberately, because
`SearchType` is threaded through URL serialization, saved searches, both query
serializers and the explain panel, all Mastodon-shaped. Widening it would have
put a "…or bluesky" case in every one. What *is* reused is everything that
operates on results after they exist: `StatusCard`, `filterLoaded`,
`buildFacets`, `statusMatchesFacet`, `sortStatuses`. Those are pure functions
over `Status[]` and needed no changes at all — the single biggest win, at zero
cost.

18 new tests.

## Measured against the live API (2026-08-01)

- **`searchPosts` requires auth.** `public.api.bsky.app` → 403, the entryway
  anonymously → 401, entryway with a session → 200. So unlike `searchActors`
  this cannot be offered in Anonymous mode, and the panel says so rather than
  failing at click time. This settles the open question from the original plan.
- **Bare handles resolve.** `author=mistersql.bsky.social` → 200 with that
  author's posts. A leading `@` is stripped by the serializer, since readers
  type one.
- **Date-only bounds are accepted and honoured.** `since=2026-01-01&
  until=2026-02-01` returned posts whose `createdAt` all fell inside the window.
  So the existing `YYYY-MM-DD` pickers need **no** widening to ISO instants —
  the original plan's worry was unfounded.
- `lang`, `tag`, `domain`, `sort=top` all → 200 and visibly change results.
- **`hitsTotal` is a ceiling, not a count**: a broad query returned exactly
  `10000`. Rendered as "about N", never as a page count.
- Empty `q` → 400 `InvalidRequest`, which the panel reports as a query problem.
- Results are full `postView`s, so `adaptPost` handles them unchanged.

Grounded in the `app.bsky.feed.searchPosts` and
`app.bsky.actor.searchActors` lexicons read 2026-08-01.

Demo at the end: the search page gets a Bluesky source. Searching finds real
Bluesky posts and accounts, refined by Bluesky's *own* filters (author,
mentions, language, domain, linked URL, hashtags, date range, top-vs-latest),
with results in the same cards as everything else — and every result clickable
through to the profile and thread pages Sprint 1 built.

## The decision: a parallel query object, not a shared one

User direction (2026-08-01), quoted because it governs the whole design:

> Search, yeah, I'm thinking that not a lot of code will be reusable. It will
> have the same UI, but the facets and filters and so on, we shouldn't try to
> force apples into round holes and square pegs into oranges.

Agreed, and the lexicons back it. Here is the actual overlap:

| Capability | Mastodon (`PostSearchCriteria`) | Bluesky (`searchPosts`) |
|---|---|---|
| free text | `words` / `exactPhrase` / `excludeWords` | `q`, Lucene syntax recommended |
| author | `author` → `from:` | `author` (at-identifier, resolves handles) |
| date range | `dates.after/before` → `after:`/`before:` | `since` / `until` (ISO datetime) |
| language | `language` → `language:` | `lang` |
| hashtag | folded into the query text | `tag[]`, **AND-matched**, no `#` |
| mentions | — | `mentions` |
| links to domain | — | `domain` |
| links to exact URL | — | `url` |
| ranking | — | `sort=top\|latest` |
| media / image / video / audio / poll | `contentType` → `has:media` etc. | **none** |
| replies | `replies` tristate → `is:reply` | **none** |
| sensitive | `sensitive` tristate | **none** |
| scope (all/public/library) | `scope` | **none** |
| local vs remote | `AccountLocation` | meaningless — one network |

Roughly a third of each side has no counterpart on the other. A union type
would leave two-thirds of its fields inapplicable on any given branch, and the
refine panel would have to grey out half its controls depending on source. So:

**`BlueskyPostSearch` and `BlueskyAccountSearch` are their own interfaces** in
`providers/bluesky/`, with their own serializer and their own refine panel
section. `MawkingbirdSearch` is untouched.

### What *is* reused

- **`Status` / `Account`** — results are adapted by the existing `adaptPost` /
  `adaptProfile`, so `StatusCard` and `AccountResultCard` need no changes.
- **The page shell** — the search box, target tabs, result list, sort dropdown,
  "filter these results" box.
- **`search-refine.ts`** — `filterLoaded`, the facet builders and grouping are
  pure functions over `Status[]`. They do not know or care where the statuses
  came from, so they work on Bluesky results for free. This is the single
  biggest reuse win and it costs nothing.
- **Saved searches** (`saved-searches.ts`) and **back-nav restore**
  (`account-search-store.ts`) — need a `source` discriminator added to the
  stored shape, then they carry either kind.

### What is not reused

- `mastodon-query-serializer.ts` → new `bluesky-query-serializer.ts`.
- `search-url.ts` → extended with a `src=bsky` param selecting which decoder
  runs. A stored Mastodon search must keep decoding as one after this lands.
- The API-call budget and hashtag fan-out. Both exist because anonymous
  Mastodon search has no full-text endpoint and has to fan out over tag
  timelines. `searchPosts` is **one call**, so none of that machinery applies —
  do not carry it over "for consistency".

## Sprint split

This is two sprints' worth if done at once. Cut so each half demos:

### 3a — Posts

1. `BlueskyPostSearch` interface + `emptyBlueskyPostSearch()`.
2. `searchPosts(criteria, cursor)` on `BlueskyApi`; adapt via `adaptPost`.
3. Serializer: criteria → params. Free text goes to `q`; everything else is a
   typed param, **not** appended to `q` as a DSL string.
4. Source switch on the posts tab; results render, cursor paging works.
5. Handle `BadQueryString` as a message under the box, not a thrown error.

### 3b — Accounts

6. `searchActors(q, cursor)` — **the one Bluesky read in this roadmap that
   does not require auth.** Worth exploiting: it can work in Anonymous mode
   where every other Bluesky feature needs a linked account.
7. Results are `profileView` (basic — no counts, no bio), so account cards show
   handle + display name + avatar only. `AccountResultCard`'s numeric facets
   have nothing to bite on; hide them for this source rather than showing zeros.
   Sprint 4 can hydrate on demand via `getProfiles`.
8. Follow-from-results, wired to `BlueskyGraph` from Sprint 1.

## Things the lexicon warns about

- `q` "Lucene syntax is recommended" — but **do not build a Lucene DSL**. The
  structured fields cover the real cases and the app's own rule is that the
  object is canonical and the query string is derived. Free text goes through
  as typed.
- Cursor "may not enable complete result set traversal". Paging must stop
  cleanly on a missing/repeated cursor rather than asserting a full walk.
- `hitsTotal` "may be rounded or incomplete" — show it as "about N" or not at
  all. Never use it to compute "page X of Y".
- `tag[]` is AND-matched. Two tags narrow, they do not broaden. Label the input
  accordingly ("posts with *all* of these tags").
- `limit` max 100, default 25. `since`/`until` are datetimes, not dates — the
  existing date pickers produce `YYYY-MM-DD` and will need widening to an ISO
  instant (midnight UTC is the sane default).

## Verify before building

- Does `searchPosts` answer anonymously from the entryway, or only with auth?
  The lexicon says "some implementations may require authentication" — measure
  it. If it works anonymously, Bluesky post search becomes available in
  Anonymous mode too, which changes how prominently it is offered.
- Whether `author` accepts a bare handle or needs a DID (lexicon says
  at-identifier and that handles are resolved, so a handle should work — but our
  `resolveHandle` is there if not).
- Real behaviour of `sort=top` vs `latest` on a small result set.

## Tests

- Serializer: each field → its param; empty fields omitted entirely (not sent
  blank); multiple tags repeat the param; dates widen to ISO instants.
- Paging: repeated cursor terminates; absent cursor terminates.
- `BadQueryString` surfaces as a message, not an unhandled error.
- URL round-trip: a Bluesky search encodes and decodes back to itself, and a
  *Mastodon* search still decodes as a Mastodon search (regression guard).
- `filterLoaded` and the facet builders operate on Bluesky results unchanged.
