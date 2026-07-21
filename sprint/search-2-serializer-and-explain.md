# Sprint 2 — Query serializer, advanced form, and Explain panel

**Goal:** turn the rich `PostSearchCriteria` into a real Mastodon full-text query for
authenticated users (§6, §8), explain anonymous hashtag transformation, and ship the Explain
panel (§9) *in the same sprint* — because we are trusting the consultant's DSL claims without a
live spike, the Explain panel is our safety net for making category-2-vs-category-1 honest.

Covers spec §4.3, §6, §8, §9, and the explanation half of §4.4/§17.

## The DSL trust bet (read before building)

Per Matthew's decision: we trust the consultant that mastodon.social's `/api/v2/search`
honors `+word`, `"exact phrase"`, `-word`, `from:@a@b`, `after:`/`before:`/`during:`,
`language:xx`, `has:media`, `-is:reply` / `is:reply`, `is:sensitive`, `in:public`/`in:library`.
**We do not verify live.** Consequences we design around:

- The serializer is the contract. If an operator is silently ignored by the server, the
  returned set is *broader* than the chips imply. The **Explain panel** must therefore show
  exactly what string was sent, so a human can spot the discrepancy.
- Any criterion we are *not* confident is server-side stays a **loaded-result filter** and its
  chip is tagged `origin: 'loaded'` (sprint 1). Per spec §6.5, finer media distinctions
  (image vs video vs audio) are always loaded-result filters even when `has:media` is sent.
- The serializer's unit tests encode our assumptions; if reality bites later, we re-point them
  and downgrade the affected criteria to loaded-result filters — no UI rewrite needed.

## Deliverables

### 1. `MastodonQuerySerializer` — `pages/search/mastodon-query-serializer.ts` (new)
Implements the `MastodonQuerySerializer` interface from spec §8. Requirements (§8):
- escape quoted values safely; normalize whitespace; omit empty conditions; deterministic
  output; no UI state read outside the criteria object.
- Map `words`→`+word` per token, `exactPhrase`→`"…"`, `excludeWords`→`-word`,
  `author`→`from:@…`, dates→`after:`/`before:`/`during:`, `language`→`language:xx`,
  `contentType` media→`has:media` (image/video/audio remain loaded filters), replies→
  `-is:reply`/`is:reply`, sensitive→`is:sensitive`/`-is:sensitive`, scope→`in:public`/`in:library`.
- **Heavily unit-tested** (`.spec.ts`) against the spec §8 worked example and edge cases
  (empty, quotes-in-phrase, unicode, exclude-only). This is the most important test file in the
  whole effort. Run via `npm run test:ci`.

### 2. Advanced post-search form — `search.html`
Replace the current date-only advanced panel (`applyAdvanced`) with the full §6 inline form,
still expanding beneath the box (not a separate page):
- §6.1 text (all-words / exact-phrase / exclude), §6.2 single author (§6.2: **no** remote
  autocomplete on keystroke — validate on blur/submit; explicit lookup button is post-MVP),
  §6.3 date bounds + presets, §6.4 single language (bundled list, no API), §6.5 content-type
  radios, §6.6 replies, §6.7 sensitive, §6.8 scope (auth only).
- Fields write into `MawkingbirdSearch.post`. On submit: authenticated → serialize + send;
  anonymous → the existing hashtag transform (sprint 1's object feeds it), with unsupported
  criteria shown as loaded-result filters.
- Anonymous author/scope fields disabled with the §19 "sign in for full-text" note.

### 3. Server-side chips flip to `origin: 'server'`
When authenticated, post criteria the serializer emits become `'server'` chips (removing one
requires a new search → "Run updated search", §10). Anonymous keeps them `'loaded'`.

### 4. Explain panel — `search.html` / small helper
Expandable §9 panel showing, for the last executed search:
- **Endpoint** (`GET /api/v2/search` or the tag-timeline calls),
- **Mastodon query** (serializer output, verbatim — the honesty anchor),
- **Server-side criteria** (human-readable list),
- **Filters applied to loaded results** (the category-2 list),
- **Anonymous transformation** (§9: `"cats dogs" was searched as hashtags #cats and #dogs`),
- API-usage line is stubbed here (`Maximum: —`) and filled by sprint 3.

To feed the anonymous section, `searchPostsByHashtags` returns the tag list it derived (it
already computes it — just surface it).

## Explicitly deferred
- Explicit author lookup button (§18) → post-MVP.
- API-usage numbers in Explain → sprint 3.
- "Apply to new search" facet→server-criterion promotion (§11.1) → can land here if time
  allows, else sprint 3.

## Status: DONE (2026-07-20)

- `mastodon-query-serializer.ts` + `.spec.ts` — reproduces the §8 example exactly; 20+ edge cases.
- Full advanced form (exact phrase / exclude / author / dates / language / content / replies /
  sensitive / scope), anonymous fields disabled with the sign-in note.
- `search-explain.ts` + `.spec.ts` — `postChips` (server vs loaded origin) and `explainPostSearch`.
- Chips + Explain panel wired in; **shown even for zero results** (Explain matters most then).
- **DSL bet verified LIVE** against mastodon.social (see [[mastodon-search-dsl-verified]]):
  `language:`, `-is:reply`, `has:media`, `from:@…`, exact phrase all honored. The mock has no
  full-text backend, so operator queries return 0 there — integration-tested the real server.
- All 918 UI tests pass; authenticated advanced search verified end-to-end in the browser.

## Acceptance
- Authenticated: fill advanced fields → Explain shows the exact generated query matching the
  §8 example; server chips vs loaded chips visually distinct.
- Anonymous: same fields → Explain shows the hashtag transformation and lists which criteria
  were downgraded to loaded-result filters; no server-only operator claimed as applied.
- `mastodon-query-serializer.spec.ts` green via `npm run test:ci`, including the §8 example.
