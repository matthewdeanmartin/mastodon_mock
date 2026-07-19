# Anonymous Mastodon — Sprint 4: local collections, tags, and RSS limits

Status: READY (written 2026-07-19 at the close of Sprint 3)

## Starting point

Anonymous can follow up to 20 Mastodon accounts through the real profile UI.
Those relationships persist locally and Home fetches their posts on demand via
public Mastodon APIs with bounded concurrency, partial failures, and RSS
fallback. Bookmarks remain a placeholder, while Lists and followed Tags are
still guarded because their existing pages assume server-owned state.

## Goal

Deliver the remaining browser-local organization primitives so Anonymous can
save posts, organize followed accounts, and mix followed hashtag searches into
Home without authenticated mutations.

## Locked product constraints

- Maximum 5 followed tags.
- Maximum 10 user-managed RSS subscriptions.
- Lists contain locally followed Mastodon accounts and fetch/mix their public
  posts client-side.
- A followed tag is a saved search. Home runs those searches on demand and
  mixes the results; the tag detail page continues to perform tag search as it
  does today.
- Bookmarks are fully local in Anonymous.
- All state remains provider-owned and versioned.
- No automatic polling or background refresh.
- Existing authenticated, Bluesky, RSS, and legacy demo behavior must remain
  unchanged.

## Planned changes

### 1. Shared Anonymous local-state boundary

- Add versioned stores for bookmarks, lists, and followed tags beneath
  `providers/anonymous/`, using common validation and migration conventions.
- Keep provider data isolated from authenticated Mastodon session/account
  storage.
- Recover from partial/malformed data without losing healthy collections.

### 2. Local bookmarks

- Turn on the Anonymous bookmark capability only after the local store is
  connected to StatusCard and the Bookmarks page.
- Store enough normalized status/account/provider metadata to render a saved
  post after reload without immediately refetching it.
- Reuse the existing Bookmark button and page, including removal and empty
  states, while issuing zero `/bookmark` or `/unbookmark` requests.
- Deduplicate by canonical post URL/provider reference.

### 3. Client-side lists

- Adapt the existing Lists UI to create, rename, and delete local lists.
- Add/remove accounts through the current list controls, restricted to locally
  followed Mastodon accounts.
- Enforce stable list/account keys so instance-specific account ids cannot
  create duplicates.
- A list timeline should invoke the Anonymous public feed client only on page
  load, refresh, or load-more and merge member posts chronologically.

### 4. Followed tags and Home mixing

- Adapt tag Follow/Following to a local saved-search store in Anonymous mode.
- Enforce the 5-tag maximum with an actionable UI message.
- Restore the Followed tags page using local state.
- Add an Anonymous tag feed source that invokes public tag timeline searches on
  demand and merges/deduplicates results with followed-account and RSS content.
- Keep direct tag pages searchable whether or not the tag is followed.

### 5. User-managed RSS maximum

- Enforce a maximum of 10 user-managed RSS subscriptions at the store boundary.
- Surface a clear limit message in Connections/Profile subscription UI.
- Keep RSS sources distinct from automatic Mastodon-account RSS fallback.
- Preserve existing enabled/disabled subscription behavior and migrations.

## Acceptance criteria

- Anonymous bookmark toggles and the Bookmarks page persist locally and perform
  no authenticated mutation.
- Local lists manage followed accounts and render demand-loaded merged posts.
- The sixth followed tag and eleventh user-managed RSS subscription are rejected
  with useful messages.
- Followed tag searches mix into Home only on explicit acquisition actions.
- Canonical URLs/handles prevent duplicates across accounts, posts, lists, and
  tags.
- No background network poll, streaming connection, or automatic refresh is
  introduced.
- Authenticated Mastodon and all existing provider regression suites remain
  green.
- Full lint, test, admin build, and Mockingbird build pass.

## Deferred to Sprint 5

- Anonymous Algo feed using the accumulated RSS/public source corpus.
- Additional Who to follow ranking beyond the boost-derived candidates already
  supported by the sidebar.
- Local-data export/import.
