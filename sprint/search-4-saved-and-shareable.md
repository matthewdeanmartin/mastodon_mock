# Sprint 4 — Saved searches + shareable URLs

**Goal:** persist the rich `MawkingbirdSearch` object so users can save, rerun, and share
structured searches. Both features read/write the *same* object the form is built on (sprints
1–2), so this is mostly serialization + storage plumbing with no new API surface.

Covers spec §15, §16, and the cross-mode explanation of §15/§17.

## Deliverables

### 1. Saved searches — `pages/search/saved-searches.ts` (new)
- Port the `SavedSearch` interface from spec §15 (`id`, `name`, `createdAt`, `updatedAt`,
  `instance`, `authenticated`, `search: MawkingbirdSearch`).
- Store **definitions only** — no results, no post bodies, no facet caches (§15). Cap ~100.
- **Account-scoped storage**: use `scopedKey()` (see `Account-scoped client settings` memory)
  so saved searches namespace per account and survive the account-switch hard-reload. Follow
  the `ClientPrefs` pattern (`providedIn: 'root'`, signal-backed, JSON in localStorage with a
  `version` field for future migration — the `MawkingbirdSearch.version: 1` already supports
  §5 "future schema migration").
- Actions (§15): run, edit, rename, duplicate, delete, copy shareable link. Save flow is the
  inline name-and-save UI from §15.
- **Cross-mode honesty (§15/§17):** opening a saved *authenticated* search while anonymous must
  explain which criteria are unavailable (author, scope, full-text) rather than silently
  substituting — reuse the Explain panel's "downgraded to loaded-result filter" language from
  sprint 2. `AnonymousCapabilities.active` is the gate.

### 2. Shareable URLs — extend `search.ts` URL handling
The page already round-trips `?q=&type=` through `ActivatedRoute`. Extend to the full object:
- **Preferred readable form** (§16): `?type=posts&q=angular&after=2026-07-01&media=image&calls=3`
  for simple searches — human-editable, the nice case.
- **Compact versioned form** for complex state (§16): `?s=<encoded-versioned-json>` (base64url
  of the `MawkingbirdSearch`, with its `version`). Pick readable when the search fits the flat
  param set, compact otherwise.
- **Hard requirements (§16):** never encode OAuth tokens; never cached results; prefer portable
  handles over numeric account IDs (matters for `author` and for our anonymous
  `anonymousAccountRouteRef` scheme); **validate every field on decode**; ignore unknown fields;
  require the schema version; **malformed URL → safe empty form**, never a crash.
- Decode feeds the same `emptySearch`-shaped object the form uses, so restoring a shared link
  and re-running is identical to normal execution (subject to sprint 3's budget).

## Interactions to respect
- The URL is a query *definition*, not a results guarantee — a shared link may return different
  results on a different instance or when opened anonymously (§16, §15). Don't imply otherwise.
- Sprint 3's `apiCallBudget` is part of the object, so it serializes into both saved searches
  and URLs (`calls=3`) for free.

## Explicitly deferred (spec "optional after MVP")
- Saved-search import/export (§15 mentions export; a JSON export button is a small add if time
  allows).
- Search history as distinct from saved searches (§18/§22 optional).

## Acceptance
- Build a post search with several advanced criteria + budget → Save → reload page → run from
  saved list → identical execution. Rename / duplicate / delete work; list capped at 100.
- Copy shareable link → open in a fresh tab → form repopulates exactly; open the same link
  while anonymous → Explain lists the unavailable criteria instead of silently changing intent.
- Hand-craft a malformed `?s=` value → form falls back to empty, no crash.
- Confirm saved searches are account-scoped: switch accounts → the other account's saved
  searches are not visible. Specs via `npm run test:ci`.
