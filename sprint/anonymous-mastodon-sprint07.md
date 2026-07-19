# Anonymous Mastodon — Sprint 7: discovery consistency and reader polish

Status: READY (written 2026-07-19 at the close of Sprint 6)

## Starting point

Anonymous now has real shared Home, Algo, Profile, Thread, Search, bookmarks,
tags, lists, follows, boost-derived suggestions, public API-first acquisition,
RSS fallback, explicit list paging, and visible per-source recovery. Public post
and profile routes preserve the source instance and never require credentials.

## Goal

Make discovery results and every secondary account/status link obey the same
cross-instance public routing rules, then harden local reader state for normal
long-lived browser use.

## Planned changes

### 1. Provider-owned anonymous discovery

- Audit Search, Find people, tag pages, trending/idle results, hover cards, and
  Who to follow for requests or links that still assume authenticated/same-
  instance ids.
- Put Anonymous public search/tag/trend requests behind provider-owned absolute
  clients and adapt results with stable source references.
- Preserve local follow/tag actions and the existing 20-account/5-tag limits.
- Keep all discovery pull-only; searches and page changes are the only triggers.

### 2. Secondary route consistency

- Route quoted posts, featured accounts, list members, suggestions, search
  results, and any remaining Anonymous account/status affordance through public
  references where the source is known.
- Use the original external URL when an RSS-derived or incomplete object has no
  safe public API reference.
- Add regression tests proving no Anonymous cross-instance click becomes a
  relative authenticated Mastodon request.

### 3. Reader and bookmark continuity

- Reconcile local bookmark state across focused posts, ancestors, descendants,
  profile timelines, and corpus snapshots so every rendering of one canonical
  post shows the same saved state.
- Improve public-thread empty/error/loading states and preserve a useful
  original link even when the focused-status request itself fails.
- Audit media, content-warning, quote, and reader-mode behavior on public
  contexts without enabling reply, favourite, boost, or writing mutations.

### 4. Local-state hardening

- Add explicit schema migration/validation coverage for follows, lists, tags,
  bookmarks, account profile, corpus, and source backoff records.
- Contain storage quota/write failures with actionable non-blocking messages;
  one malformed collection must not erase unrelated Anonymous state.
- Keep export/import and multiple Anonymous accounts deferred.

## Acceptance criteria

- Supported Anonymous discovery paths use public source-instance APIs and all
  resulting profile/post links open the shared in-app readers correctly.
- No cross-instance native id is issued as a relative authenticated request.
- Canonically identical posts display consistent local bookmark state across
  feeds, profiles, threads, lists, and Algo.
- RSS/incomplete objects fall back safely to their original URL.
- Local-state corruption or quota failure is isolated and visible.
- No polling, streaming, background refresh, or new anonymous server mutation
  is introduced.
- Authenticated Mastodon, Bluesky, user RSS, legacy demo, tests, lint, and both
  builds remain green.

## Deferred

- Local-data export/import.
- Multiple Anonymous virtual accounts.
- Bluesky anonymous acquisition.
