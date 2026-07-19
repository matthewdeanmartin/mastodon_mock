# Anonymous Mastodon — Sprint 6: public navigation and hardening

Status: COMPLETE (implemented and verified 2026-07-19)

## Starting point

Anonymous now has pull-only Home and Algo feeds, local follows/bookmarks/lists/
tags, user RSS, a bounded public corpus, boost-derived Who to follow, and
contained API/RSS failures. Status cards from `anonymous-mastodon` render the
real shared UI, but their source-instance account/status ids cannot yet be sent
through routes that assume the selected home instance.

## Goal

Close the most visible real-app navigation and collection gaps while keeping
all Anonymous requests absolute, public, token-free, and demand-driven.

## Planned changes

### 1. Cross-instance public account routes

- Define a stable route reference carrying source instance plus native account
  id without treating it as the selected home instance's id.
- Make Anonymous Mastodon status-card avatar/name links open the real Profile
  UI using absolute public account/status endpoints.
- Preserve local Follow/Following and list membership controls on those
  profiles using canonical federated account identity.
- Ensure boost target profiles resolve on the correct instance too.

### 2. Public thread routes

- Carry source instance plus native status id through Anonymous card links.
- Load status context from the public Mastodon API on click only, keeping reply
  boxes and every server mutation hidden.
- Fall back to “Open original” when a source does not expose anonymous context;
  one failed context request must not damage the surrounding feed/corpus.

### 3. List timeline depth

- Add per-member cursors and explicit Load more to local list timelines rather
  than stopping at the first merged page.
- Keep bounded concurrency, partial-source failure isolation, canonical
  deduplication, and corpus ingestion across pages.
- Surface useful empty/member/source-warning states without bulk-import or
  authenticated list calls.

### 4. Resilience and UI diagnostics

- Expose Anonymous provider warnings in a clear but non-blocking place so users
  can tell API fallback, CORS failure, and temporary deferral apart.
- Provide an explicit retry path that can clear a selected follow's backoff;
  do not turn retry into polling.
- Audit remaining guarded/hidden routes and labels so supported local features
  are reachable and unsupported identity features remain absent.

## Acceptance criteria

- Clicking an Anonymous Mastodon author opens their real shared Profile UI and
  can locally follow/unfollow them without authenticated mutations.
- Clicking a public post opens its thread when anonymous context is available,
  otherwise offers the original URL without breaking navigation.
- Local lists page beyond the first member page only after explicit Load more.
- Cross-instance ids never accidentally hit the selected home instance.
- Provider errors remain per-source and do not break Home, Algo, lists, or the
  persisted corpus.
- No background acquisition is introduced, and authenticated Mastodon,
  Bluesky, user RSS, legacy demo, tests, lint, and both builds remain green.

## Deferred

- Local-data export/import.
- Multiple Anonymous virtual accounts.
- Bluesky anonymous acquisition.

## Delivered

- Added validated, URL-safe public account/status route references carrying the
  source origin, native object id, and optional original URL.
- Anonymous Mastodon avatars, author names, timestamps, post bodies, keyboard
  open, and keyboard profile navigation now enter the shared Profile and Thread
  UI without confusing namespaced ids with ids on the selected home instance.
- Added a provider-owned, read-only public Mastodon API client. All calls are
  absolute, token-free external fetches with bounded timeouts.
- Public profiles load account data, posts, pinned posts, filtered paging, and
  explicit older pages from their source instance. Follow/unfollow remains
  browser-local and uses canonical federated identity.
- Public thread view loads the focused status and context independently. A
  blocked/failed context endpoint leaves the focused post readable, explains
  the limitation, and links to the original. Reply boxes and server mutations
  stay absent; local bookmarks work in reader mode.
- RSS-fallback posts do not claim a Mastodon thread endpoint, but their author
  can still open as a public profile when a native account id is available.
- Local list timelines now own independent per-member cursors, merge/dedupe
  each explicitly requested page, ingest those pages into the Anonymous corpus,
  isolate failed members, and expose Load more only while sources have depth.
- Home and list timelines surface non-blocking source warnings. Anonymous
  Follows settings lists local follows, distinguishes public API/RSS fallback/
  temporary deferral, supports unfollow, and offers a one-shot API retry that
  clears only local backoff state.
- Public feed acquisition was also marked as external fetch throughout the
  Anonymous provider so signed-in credentials and same-origin health handling
  cannot leak to arbitrary Mastodon instances.

## Verification

- `npm run lint` — pass.
- `npm test -- --no-watch` — 814 tests passed across 101 files.
- `npm run build` — pass.
- `npm run build:mockingbird` — pass.
- `git diff --check` — pass.
