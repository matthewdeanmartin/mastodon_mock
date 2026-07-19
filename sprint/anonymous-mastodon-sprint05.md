# Anonymous Mastodon — Sprint 5: local corpus and Algo

Status: READY (written 2026-07-19 at the close of Sprint 4)

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
