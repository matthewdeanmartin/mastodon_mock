# Sprint 4 — People browser, hover card, and the rest of the graph

Status: **DONE** (2026-08-01). 2734 tests pass, lint clean, production build
green.

## What shipped

- `people-source.ts` — the `PeopleSource` interface and `PeoplePage`.
- `people-sources.ts` — four implementations (Mastodon, anonymous-public,
  local-anonymous, Bluesky) behind a `PeopleSourceFactory`.
- `people-browser.ts` — rewritten against the interface; **no spec changes**.
- `bluesky-api.ts` — `getFollowers`, `getFollows`, `block`, `muteActor`,
  `unmuteActor`.
- `bluesky-graph.ts` — `block`/`unblock` (records, uri-cached like follow) and
  `mute`/`unmute` (procedures, no uri).
- Profile: tabs, counts-as-buttons and a Bluesky ••• menu with real mute/block.
- Hover card: Bluesky follow state and follow/unfollow.

11 new tests.

**The refactor landed with every existing people-browser spec untouched and
green** — which was the whole safety argument for doing it as option 2 rather
than adding a third inline branch.

### Decisions worth keeping

**`canFollow` is a source property.** An anonymous Bluesky view reads fine but
has no session to write with, so the button comes off rather than failing on
click. The Mastodon and anonymous sources return true; only Bluesky-signed-out
returns false.

**Bluesky needs no relationship request.** Measured: `getFollowers`/`getFollows`
populate `viewer` inline when authenticated (`following`, `followedBy`,
`muted`, `blockedBy`, and two `mutedOnly*` flags). The source harvests it during
`fetch` and `relationships()` returns it with no round trip. Signed out there is
no `viewer` at all and the map is empty — which the browser reads as *unknown*,
not "not following".

**The hover card's `hasStats` now asks the data, not the id.** It excluded every
namespaced id because foreign adapters zero-fill counts. But the same Bluesky
account arriving from search or a people list came through `adaptProfile` and
carries real numbers, and the id test hid those too. Now: any non-zero count
means somebody actually told us something.

**Bluesky mute/block are real, and outrank local moderation.** A linked session
can write a block the other account sees, so `useLocalModeration` returns false
for Bluesky. The one exception is a *timed* mute — Bluesky mutes have no
duration, so "mute for 5 minutes" stays local and keeps meaning what it says.

**Unfollowing from your own following list removes the row.** Previously
anonymous-only via `isLocalAnonymousList()`; now `isOwnFollowingList()`, which
covers signed-in users too. In anonymous mode `auth.account()` *is*
`anonymous.account()`, so the old behaviour is preserved exactly.

### Deliberately still out

- **Report** on the Bluesky ••• menu: reporting goes to a labeler service this
  app has no UI for.
- **Analytics and Collections tabs** stay hidden for Bluesky — the first reads
  Mastodon status metadata, the second is a Mastodon 4.6 feature.
- `mutedOnlyReposts` / `mutedOnlyQuoteposts`, which arrived in the viewer block
  and have no Mastodon counterpart.

---

Original plan follows.

Depends on Sprint 1 (`BlueskyGraph`) and reads better after
Sprint 3 (search results are where you meet new accounts).

Demo at the end: the Following / Followers tabs work on a Bluesky profile, the
counts become buttons again, hovering a Bluesky avatar anywhere in the app shows
a real card with bio, counts, "Follows you" and a working Follow button.

## Why this is its own sprint

Sprint 1 deliberately *hid* the profile tab row for Bluesky rather than letting
it 404, and left the hover card degraded. That was the honest short-term call —
every tab behind that row reads a Mastodon endpoint with an account id this
server never issued. This sprint pays it off.

## The obstacle: `PeopleBrowser` takes a server, not a provider

`people-browser.ts` branches on `auth.isAnonymous && server` to choose between
`Api` and `AnonymousPublicApi`. That is a two-case switch hard-coded in the
component (`:85-95`), and both cases speak Mastodon.

Two options, and the second is recommended:

1. **Add a third branch** for `bsky:` ids. Fastest, but makes a component that
   already has two transports grow a third inline, and the next provider makes
   it four.
2. **Extract a `PeopleSource` interface** — `followers(id, cursor)` /
   `following(id, cursor)` returning `{accounts, cursor}` — with three
   implementations (`Api`, `AnonymousPublicApi`, `BlueskyGraph`). The component
   picks one and stops knowing about transports.

Option 2 is the same move `ListSource` made for the Lists tab (see
`best-list-tab` / `sprint/lists-0-overview.md`), it is a known-good pattern in
this codebase, and it is what makes Sprint 5's feed work cheap. Do it here.

Note the paging models differ: Mastodon pages people with `max_id` / Link
headers, Bluesky with an opaque `cursor`. `PeopleSource` should return an opaque
`cursor?: string` and let each implementation decide what it means — the
component only ever passes it back.

## Work

1. **`getFollowers` / `getFollows` on `BlueskyApi`** —
   `app.bsky.graph.getFollowers` and `app.bsky.graph.getFollows`, both
   `{actor, limit, cursor}` → `{subject, followers|follows, cursor}`. Adapt with
   the existing `adaptAuthor` (these return `profileView`, not detailed).
2. **`PeopleSource`** extracted, three implementations, `PeopleBrowser`
   rewritten against it. This is the risky refactor — it touches a component
   used by Mastodon and anonymous profiles, both of which have tests. Land it
   with those tests green *before* adding the Bluesky implementation.
3. **Un-hide the tabs** in `profile.html`: drop `!isBluesky()` from the tab row
   and the people-browser block, turn the counts back into buttons. Leave
   collections and analytics hidden — those have no Bluesky equivalent at all.
4. **Hover card.** `showFollowButton` currently excludes every id containing
   `:` (`account-hover-card.ts:223-229`), which is what keeps Bluesky safe
   today. Narrow that to "not a client-side-only provider" and route the
   relationship fetch + follow through `BlueskyGraph` for `bsky:` ids.
   - Careful: the hover card fetches on `mouseenter`. For Bluesky that is a
     `getProfile` per hover. Cache by DID (the `BlueskyGraph` cache is already
     there for follow uris — extend it, or add a short-TTL profile cache).
5. **Hydrate search account results.** Sprint 3b's account results are
   `profileView` with no counts or bio. `app.bsky.actor.getProfiles` takes up to
   25 actors in one call — hydrate a page of results with one request so the
   cards show counts and the numeric facets work.
6. **Block and mute** on `BlueskyGraph`, completing the moderation row:
   `app.bsky.graph.block` (a record, like follow — delete to unblock) and
   `app.bsky.graph.muteActor` / `unmuteActor` (procedures, not records — no uri
   to keep). Wire the profile's ••• menu for Bluesky accounts.

## Watch out

- **`getFollows` is "who this actor follows"**, named inconsistently with
  `getFollowers`. Easy to swap; the tab labels would silently lie.
- Bluesky returns a `subject` alongside the list. Ignore it or use it to refresh
  the header counts, but do not let it overwrite a detailed profile with a basic
  one.
- A private/blocked actor's follow lists can 400. Same treatment as everywhere
  else: say "could not load", not "no followers".

## Tests

- `PeopleSource` refactor: existing Mastodon and anonymous people-browser specs
  pass unchanged (this is the whole safety argument for the refactor).
- Bluesky source: followers vs following hit the right NSID; cursor paging;
  cursor exhaustion.
- Hover card: a `bsky:` account shows a follow button and fetches through
  `BlueskyGraph`, not `Api`; a `twitter:`/`rss:` account still shows none.
- Profile: tabs visible for Bluesky; collections/analytics still hidden.
