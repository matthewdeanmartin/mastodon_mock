# Sprint 1 — Profile + follow

Status: **DONE** (2026-08-01). 2673 tests pass, lint clean.

Demo: click any Bluesky avatar or display name in the home feed → a real profile
page with bio, banner, counts and the account's posts, paging properly, with a
Follow button that writes a real follow record.

## What shipped

### New API surface (`bluesky-api.ts`)

- `getAuthorFeed(actor, cursor, filter)` — `app.bsky.feed.getAuthorFeed`,
  cursor-paged like `getTimeline`.
- `follow(did)` — creates an `app.bsky.graph.follow` record, returns its at-uri.

Unfollow needed nothing new: it is `deleteRecord` on the follow record's uri,
which the existing helper already covers.

### New types (`bluesky-types.ts`)

- `BskyViewerState` — `following` / `followedBy` / `blocking` / `muted`.
  **These are at-uris, not booleans**: the presence of the string is the
  boolean, and the string itself is what unfollowing needs.
- `BskyAuthorFeedFilter` — the four server-side filter values.
- `BskyProfile.viewer?: BskyViewerState`.

### New adapters (`bluesky-adapter.ts`)

- `adaptProfile(BskyProfile): Account` — the richer sibling of `adaptAuthor`,
  which only ever sees the trimmed `profileView` embedded in a post and so has
  to zero the counts. This one carries bio, banner and all three counts.
- `adaptRelationship(BskyProfile): Relationship`.

`adaptDescription` escapes the bio and paragraphs it. Deliberately not rich
text: `getProfile` returns `description` as a bare string **with no facets**, so
links in a bio arrive as text and stay text.

### New service (`bluesky-graph.ts`)

`BlueskyGraph` — follow / unfollow / relationship, all returning Mastodon
`Relationship`.

It exists because **AT Protocol has no unfollow verb.** Unfollowing deletes the
follow record by its at-uri, which only the create call returns. So the service
caches `did → follow-uri` for the tab's lifetime and falls back to
`getProfile().viewer.following` when the cache is cold — a reload, or an account
followed in another client. Without that fallback, unfollow on a freshly loaded
page would silently no-op.

`unfollow` on an account with no follow record reports "not following" rather
than erroring: that is the end state the caller wanted.

### Page wiring

- `status-card.ts` `accountLink` — a `bluesky` case, so avatars and names stop
  being dead text. DIDs are route-safe.
- `profile.ts` — `loadBluesky(did)`: `getProfile` + `getAuthorFeed` in parallel,
  wired into the existing `loadMore` and `reloadStatuses` so paging and the
  replies toggle work.
- `profile.html` — a Bluesky branch in the header buttons.

## Decisions worth keeping

**Addressed by DID, not handle.** The route carries `bsky:did:plc:…`. Handles
are rentable and can change; DIDs cannot. A bookmarked profile URL keeps working
after a rename.

**The replies toggle re-queries rather than re-filters.** Bluesky applies the
filter server-side, so "hide replies" is a *different query*. Filtering locally
over a fixed page would return short pages and eventually an empty one that
looks like the end of the history.

Mastodon takes boosts and replies as two independent params; Bluesky takes one
enum with no "replies but no reposts" member. Where they disagree the replies
toggle wins (it is the one a reader sets deliberately) and the boosts toggle is
applied client-side by the existing `visibleStatuses`.

**Tabs are hidden, not broken.** Following / followers / collections / analytics
all read Mastodon endpoints with an account id this server never issued. The
row is hidden for Bluesky rather than left to 404. The counts still show, as
plain numbers instead of buttons that would open an empty tab. Sprint 4 turns
them back on.

**The hover card needed no change.** Its `showFollowButton` already excludes ids
containing `:`, which covers `bsky:` — so no stray Mastodon relationship calls.
It degrades to bio-and-counts, which is correct. Wiring it to `BlueskyGraph` is
Sprint 4's job.

**A failed load says so.** `bskyError` distinguishes "could not load" from
"does not exist" — the generic fallback would send a reader to check a handle
that was never the problem. An unlinked session gets its own message pointing at
Settings → Connections.

## Tests added

- `bluesky-graph.spec.ts` (6) — follow record shape; unfollow from cache with no
  extra lookup; unfollow cold-cache resolving via `getProfile`; unfollow with no
  record deleting nothing; viewer-state mapping; the cache warming.
- `bluesky-adapter.spec.ts` (+9) — profile counts/banner, bio escaping,
  paragraph splitting, empty bio, placeholder fallbacks, relationship mapping.
- `bluesky-api.spec.ts` (+3) — author-feed params and filter, cursor omitted on
  first page, follow record written into the viewer's own repo.

## Known gaps, deliberately left

- No people browser on a Bluesky profile (Sprint 4).
- No block/mute — `app.bsky.graph.block` and `muteActor` exist and would slot
  into `BlueskyGraph` beside `follow`. Local moderation already covers the
  reader-side need, so this is low priority.
- No "Follows you" on the hover card for Bluesky accounts (Sprint 4).
- Self-profile for the linked Bluesky account is reachable by DID but is not
  wired into the left rail's profile stack.
