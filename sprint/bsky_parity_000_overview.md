# Bluesky parity — roadmap

Status: SPRINTS 1–2 DONE (2026-08-01). Sprints 3–5 READY.

Goal: **the Bluesky experience in Mockingbird is the same experience as
Mastodon** — same pages, same cards, same gestures — for everything a reader
does. Where the two protocols genuinely differ, the difference shows up as a
*different query*, not as a different UI.

## Where we started (2026-08-01)

Already working: home feed (merged, via `FeedProvider`), reply, post, chat,
click-a-post-to-expand-the-thread, like/repost with undo, quotes, images,
facet-accurate rich text.

Missing: notifications, click-to-profile, follow, and any search that targets
Bluesky.

`providers/bluesky/` was already the right shape for all of it. `BlueskyApi`
is a generic XRPC client — `get<T>(nsid, params)` and `request<T>(nsid, body)`
are public and take arbitrary NSIDs, with token refresh already handled — so
every sprint below is **an adapter plus a page branch, not new transport**.

## Standing constraints

These are not negotiable per-sprint; they are why several obvious designs are
rejected below.

1. **Client-side only.** No backend, ever. Everything must work from the browser
   against the real network (`mockingbird-client-side-constraint`).
2. **Nothing outside `providers/` learns another protocol exists.** Bluesky
   adapts *into* Mastodon's `Status` / `Account` / `Relationship` at the edge.
   Established by `sprint/roadmap-providers.md`, upheld by the RSS, Twitter and
   anonymous providers.
3. **Ids are namespaced.** `bsky:<did>` for accounts, `bsky:<at-uri>` for posts.
4. **The entryway is not the PDS.** `bsky.social` answers AppView reads.
   Service-proxied calls need the account's real PDS — this bit us on chat (see
   `bsky-chat-pds` memory and the note on `BlueskyApi.get`). **Verify per
   endpoint as each sprint lands rather than assuming either way.**

   Measured so far, all at the entryway with an app-password session:
   `getTimeline`, `getProfile`, `getAuthorFeed`, `createRecord`/`deleteRecord`,
   `listNotifications`, `getPosts` — **all fine**. Only `chat.bsky.convo.*` has
   needed the real PDS. The rule is "verify", not "assume the worst".

## Sprint list

| # | Theme | Demo at the end | Status |
|---|---|---|---|
| 1 | [Profile + follow](bsky_parity_001_profile_and_follow.md) | Click any bsky avatar → real profile, with a working Follow button | **DONE** |
| 2 | [Notifications](bsky_parity_002_notifications.md) | A Bluesky tab on /notifications: likes, reposts, follows, replies, mentions, quotes | **DONE** |
| 3 | [Search](bsky_parity_003_search.md) | Search page finds bsky posts and accounts, with Bluesky's own filters | READY |
| 4 | [People browser](bsky_parity_004_people_browser.md) | Followers/following tabs work on a bsky profile; follow from search results | READY |
| 5 | [Feeds + lists](bsky_parity_005_feeds.md) | Bluesky's custom feeds *and* curated lists, as two new sections on the Feeds tab | READY |

Each sprint ends with something demoable on its own. They are ordered so that
each one makes the previous more useful: profiles make search results clickable,
search makes the people browser reachable, and so on.

## The one big design decision: search is not shared code

Confirmed with the user (2026-08-01). The Mastodon search page is 1,761 lines
built around Mastodon's search DSL (`from:`, `has:media`, `is:reply`), a
hashtag fan-out for anonymous mode, and an API-call budget. Bluesky's
`app.bsky.feed.searchPosts` is a *single call* with **its own** parameter set:
`author`, `mentions`, `lang`, `domain`, `url`, `tag[]`, `since`, `until`,
`sort=top|latest`.

These overlap but do not nest. `domain:` and `url:` have no Mastodon
equivalent; `has:media` and `is:reply` have no Bluesky equivalent; Bluesky's
`sort=top` has no Mastodon equivalent at all.

**So Sprint 3 does not thread Bluesky through `fetchAccounts`/`fetchPosts`.**
It builds a parallel query object with Bluesky's own facets, reusing the *UI*
(the same result cards, the same refine panel shell, the same saved-search
plumbing) and none of the query logic. Forcing one criteria object to serve
both would mean a union type where two-thirds of the fields are inapplicable on
any given branch — which is the "apples into round holes" the user explicitly
ruled out.

## Facts established by reading the lexicons (2026-08-01)

Grounded in `github.com/bluesky-social/atproto/lexicons`, not memory. Two of
these corrected assumptions made in the initial assessment:

- **`listNotifications` carries the subject `record` inline** (`"required":
  ["uri","cid","author","reason","record","isRead","indexedAt"]`). The earlier
  plan assumed a second `getPosts` call to hydrate. It is still needed, but for
  a *different* reason — see Sprint 2.
- **There are 13 notification reasons**, not 6: `like`, `repost`, `follow`,
  `mention`, `reply`, `quote`, `starterpack-joined`, `verified`, `unverified`,
  `like-via-repost`, `repost-via-repost`, `subscribed-post`, `contact-match`.
  `knownValues` is not a closed enum in AT Protocol — unknown reasons must not
  crash the list.
- `searchPosts` recommends **Lucene syntax** in `q` and has a documented
  `BadQueryString` error.
- `searchActors` **does not require auth** — the only Bluesky read in this
  roadmap that works for a logged-out viewer.
- `searchPosts` warns its cursor "may not enable complete result set
  traversal", so paging must degrade gracefully rather than assert.

## Product decisions (user, 2026-08-01)

- **Bluesky feeds live on the Feeds tab, in their own section** — "as far as my
  app is concerned they're yet another sort of feed". That is the existing
  sectioned structure at `/feeds/lists`, not a new page.
- **Feeds and lists are separate kinds**, because they genuinely are different
  things: a feed is a third-party algorithm with no membership, a list is a
  curated set of accounts. They differ in `memberOrigin`, so they render
  differently. Two `ListSource` kinds, two sections.
- **Deferred:** whether a *pinned* Bluesky feed should be able to feed the
  merged home timeline. Sprint 5 reads `pinned` and sorts by it, and touches
  nothing on /home, which keeps the option open either way.
