# Anonymous Mastodon — Sprint 5: local corpus and Algo

Status: COMPLETE (completed 2026-07-19)

## Starting point

Anonymous Home demand-loads and merges public posts from up to 20 followed
Mastodon accounts, up to 5 followed hashtag searches, and up to 10 user-managed
RSS feeds. Public API acquisition is preferred for Mastodon follows, RSS is a
contained fallback, and local lists reuse the same pull-only source loader.
Bookmarks, follows, tags, and lists are versioned provider-owned state.

## Goal

Enable the real Algo experience for Anonymous using a browser-local corpus of
public/RSS statuses, while preserving on-demand acquisition and improving
boost-derived Who to follow without a curated directory.

## Planned changes

### 1. Anonymous feed corpus

- Add a provider-owned corpus boundary that accepts normalized statuses from
  Anonymous Mastodon, followed tags, lists where appropriate, and user-managed
  RSS.
- Canonically deduplicate across provider/status ids using original URLs and
  provider references.
- Define bounded retention and versioned persistence so Algo remains useful
  after reload without unbounded localStorage growth.
- Keep ingestion passive: only already-authorized load, refresh, load-more, or
  explicit Algo refresh actions may acquire network data.

### 2. Anonymous Algo

- Adapt the existing Algo scoring pipeline to consume the local corpus instead
  of authenticated Home/bookmark/favourite APIs.
- Remove the Anonymous route guard only after the page is fully public/local
  and shared compose/server actions remain capability-gated.
- Provide clear empty and stale-corpus states with links back to Home, Search,
  followed tags, and RSS Connections.
- Add an explicit refresh action; never add polling, streaming, visibility
  refresh, or an interval-driven request.

### 3. Who to follow ranking

- Continue deriving candidates only from boosts/reblogs in acquired posts.
- Canonically exclude locally followed accounts and the local Anonymous
  identity across instances.
- Rank using transparent local signals such as distinct boosters, recurrence,
  recency, and presence in multiple sources; do not introduce a curated list.

### 4. Resilience and diagnostics

- Persist or honor per-follow API backoff/source preference so repeatedly
  unavailable APIs do not immediately retry a CORS-blocked RSS fallback on
  every explicit acquisition.
- Surface per-source warnings without turning the whole Algo/Home corpus into
  an error state.
- Add global canonical deduplication where Home currently deduplicates only
  within individual providers.

## Acceptance criteria

- Anonymous can open Algo and receive ranked statuses solely from the local
  public/RSS corpus, with zero authenticated timeline or mutation calls.
- Opening/refreshing Algo is demand-driven and no background network activity
  is introduced.
- Corpus retention is bounded, versioned, malformed-state tolerant, and
  canonical-URL deduplicated across sources.
- Who to follow remains boost-derived, excludes local follows, and has no
  curated seed list.
- One unavailable public API or CORS-blocked RSS source cannot break Home or
  Algo.
- Authenticated Mastodon, Bluesky, RSS, legacy demo, lint, tests, and both
  production builds remain green.

## Deferred

- Local-data export/import.
- Multiple Anonymous virtual accounts.
- Bluesky anonymous acquisition.

## Outcome

- Added a provider-owned, versioned Anonymous feed corpus with canonical URL /
  provider-reference deduplication, malformed-state recovery, chronological
  ordering, and a hard 500-status retention bound.
- Home, explicit Algo acquisition, and local-list timelines ingest already
  acquired public Mastodon/RSS statuses into the corpus. Ingestion never causes
  a network request itself.
- Enabled the real Algo route for Anonymous. Its explicit build/refresh path
  reuses the pull-only feed aggregator, then ranks the local corpus without
  calling authenticated following, followers, Home, bookmark, favourite, or
  mutation endpoints.
- Anonymous Algo includes zero-engagement RSS/public posts instead of applying
  the signed-in feed's one-like floor, identifies followed authors locally, and
  labels followed-account, boost, hashtag, and RSS reasons in the existing UI.
- Added local bookmark-tail behavior at Home's feed cap so Anonymous never
  calls the server bookmark endpoint.
- Added global canonical status deduplication to accumulated Home pages.
- Who to follow remains derived only from boosts found in acquired content and
  now ranks candidates by distinct boosters, source diversity, recurrence, and
  recency before excluding the local identity and local follows.
- Persisted per-follow source behavior: successful public APIs clear backoff,
  working RSS fallbacks are preferred briefly, and an account whose API and RSS
  both fail is deferred for 15 minutes without extending that window on every
  explicit refresh.
- No interval, background refresh, streaming connection, visibility listener,
  or automatic network poll was introduced.

## Verification

- Full coverage-enabled Angular suite: 804 tests passed.
- `npm run lint`: passed with zero warnings.
- TypeScript application compilation: passed.
- `npm run build`: passed.
- `npm run build:mockingbird`: passed.
- `git diff --check`: passed.

## Handoff

Continue with `anonymous-mastodon-sprint06.md`. The major remaining usability
gap is public navigation: `anonymous-mastodon` cards still cannot open a usable
cross-instance author profile or thread inside the app because native ids are
currently scoped to their source instance. Preserve absolute, token-free API
resolution when addressing that gap.
