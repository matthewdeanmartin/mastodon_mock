# Anonymous Mastodon — Sprint 6: public navigation and hardening

Status: READY (written 2026-07-19 at the close of Sprint 5)

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
