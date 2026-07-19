# Anonymous Mastodon — Sprint 3: local follows and API-first home feed

Status: COMPLETE (2026-07-19)

## Starting point

Anonymous is a durable virtual account in the real app shell. Its profile is
fully browser-local, authenticated-only routes are safe, writing UI is absent,
and public Search remains available. Relationship controls are intentionally
disabled and Home is intentionally empty until this sprint provides a local
follow model and anonymous feed source.

## Goal

Make Anonymous useful for reading Mastodon: follow public accounts through the
normal UI, retain those follows locally, and build Home on demand from their
public posts using anonymous Mastodon APIs first.

## Locked product constraints

- Exactly one Anonymous identity; it may follow accounts on any Mastodon
  instance.
- Maximum 20 followed Mastodon accounts.
- Follow/Unfollow uses the normal account/profile UI but never sends a
  relationship mutation to a Mastodon server.
- Anonymous Mastodon API access is best-effort and may vary by instance.
- Prefer public API endpoints. RSS is fallback only for unavailable,
  rate-limited, or poorly performing API sources.
- Requests happen only on explicit page load/refresh/load-more. No timers,
  streaming connection, or background polling.
- Bluesky remains unavailable in Anonymous.
- Existing authenticated and legacy demo behavior must not change.

## Planned changes

### 1. Provider-owned local follow store

- Add a versioned follow schema under `providers/anonymous/` containing a
  canonical account key, handle, profile URL, home instance, account snapshot,
  acquisition preference, and timestamps.
- Normalize profile URLs and `@user@host` handles so the same account cannot be
  followed twice through different spellings.
- Enforce the 20-account cap atomically and return a user-facing result rather
  than silently discarding a follow.
- Preserve follows when the Anonymous display identity or selected home
  instance changes.
- Recover safely from malformed or older local data.

### 2. Relationship facade integration

- Route Anonymous relationship reads and Follow/Unfollow actions through a
  provider facade while retaining the existing profile/account control UI.
- Synthesize Mastodon-shaped `Relationship` state from the local store.
- Update account hover cards, profile actions, search results, and any shared
  follow buttons that currently call authenticated relationship endpoints.
- Turn on `canManageRelationships` only when the Anonymous local implementation
  is active.
- Add a clear 20-follow limit message and never issue `/follow`, `/unfollow`, or
  authenticated relationship requests in Anonymous mode.

### 3. Anonymous public Mastodon client

- Resolve remote accounts from exact handles/profile URLs using token-free,
  instance-scoped endpoints where available.
- Fetch public account statuses from the account's own instance, not merely the
  selected Anonymous home instance.
- Request public, non-authenticated data only; tolerate endpoints that reject
  anonymous access.
- Add bounded concurrency, per-source timeouts, short local caching, and
  normalized error categories for unavailable/rate-limited/invalid sources.
- Keep request orchestration explicitly pull-based so cache refresh never
  creates polling.

### 4. Feed provider and merging

- Implement an Anonymous Mastodon `FeedProvider` and register it with the
  existing feed aggregator only while Anonymous is active.
- Fetch followed sources concurrently within the bound, adapt statuses to the
  shared model, merge by creation time, and deduplicate boosts/cross-source
  duplicates using canonical URLs/provider references.
- Preserve partial results when one instance fails and expose a concise source
  warning rather than failing the whole feed.
- Make Home initial load, manual refresh, and load-more the only acquisition
  triggers.
- Do not introduce automatic refresh, Streaming, or visibility-based polling.

### 5. RSS fallback boundary

- Attempt Mastodon API acquisition first.
- Fall back to the public account RSS feed only for categorized API failure or
  unacceptable response behavior; remember the preference briefly so repeated
  refreshes do not hammer a failing API.
- Reuse the RSS adapter where possible while retaining Mastodon account identity
  and canonical post URLs for deduplication.
- Keep user-managed RSS subscriptions separate; their 10-source limit remains a
  later provider/settings concern unless required by feed integration.

## Acceptance criteria

- Following and unfollowing from existing UI updates local state immediately
  and survives reload.
- The 21st unique Mastodon follow is rejected with a useful message.
- Anonymous relationship UI performs zero authenticated relationship requests.
- Home shows a merged, newest-first feed from up to 20 followed Mastodon
  accounts.
- One failing or rate-limited instance does not erase successful feed results.
- RSS is demonstrably fallback, not the primary acquisition path.
- Refresh/load-more are demand-driven and no timer, stream, or background poll
  is introduced.
- Authenticated Mastodon, RSS, Bluesky, and `/demo` regression tests remain
  green.
- Full lint, test, admin build, and Mockingbird build pass.

## Deferred to Sprint 4

- Local bookmarks.
- Client-side lists and list timelines.
- Followed tag store (maximum 5) and tag-feed mixing.
- Enforcing the maximum 10 user-managed RSS subscriptions if not required in
  Sprint 3.

## Outcome

- Added a versioned, provider-owned Anonymous follow store with canonical
  `username@host` identity, cross-instance profile metadata, malformed-state
  recovery, deduplication, and an atomic 20-account maximum.
- The real profile Follow/Following button now reads and writes that local
  store in Anonymous mode. Unfollow is immediate, reload-safe, and never calls
  Mastodon's relationship mutation endpoints.
- Kept Lists, Report, Mute, and Block separate from local Follow so enabling
  follows did not accidentally expose unsupported server actions.
- Featured-profile Follow and Follow all use the same local relationship path.
- Added an `anonymous-mastodon` feed provider to the existing aggregator. It
  resolves each followed account on that account's own instance and requests
  its public statuses without credentials.
- Acquisition is pull-only: Home load, manual refresh, and Load more drive the
  provider. No timer, stream, visibility refresh, or background network poll
  was introduced.
- Requests use four-source bounded concurrency, eight-second timeouts,
  per-session account-id caching, source cursors, chronological merging, URL
  deduplication, and partial-failure isolation.
- Anonymous API failure falls back to the account's public profile RSS feed.
  The UI reports fallback/failure through the provider error surface.
- Anonymous Mastodon posts use namespaced provider ids and remain read-only in
  the shared status card.
- Home's empty state now directs users to Search/Profile to follow accounts.
- The sidebar shows the real local following count. Boost-derived Who to follow
  candidates use local relationships and local Follow in Anonymous mode.
- Authenticated Mastodon, Bluesky, user-managed RSS, and `/demo` behavior remain
  separate.

## Verification

- Focused Sprint 3 suite: 8 files, 40 tests passed.
- Full `npm run test:ci` coverage-enabled Angular suite: passed.
- `npm run lint`: passed with zero warnings.
- TypeScript application compilation: passed.
- `npm run build`: passed.
- `npm run build:mockingbird`: passed.
- `git diff --check`: passed.

## Handoff

Continue with `anonymous-mastodon-sprint04.md`. Local follows and an API-first
Home feed are now the stable substrate. Sprint 4 should reuse the same
provider-owned storage boundary for bookmarks, lists, followed tags, and the
user-managed RSS limit rather than introducing page-owned localStorage keys.
