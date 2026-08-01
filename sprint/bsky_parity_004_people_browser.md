# Sprint 4 — People browser, hover card, and the rest of the graph

Status: READY. Depends on Sprint 1 (`BlueskyGraph`) and reads better after
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
