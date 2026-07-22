# Best-list-tab-ever — grounded plan & sprint index

TweetDeck wins on columns. We compete single-column by making the **Lists tab the one
place every kind of custom feed lives**, each presented uniformly as *a feed of posts +
a synthetic member list*. A "list" is any saved or preset collection of users **or**
posts; when it's a collection of posts, the synthetic members are the authors.

## The unifying idea: a "list" is a feed source with synthetic members

Every entry on the Lists page resolves to the same runtime shape:

- a **Posts** tab (reverse-chron feed), and
- a **Members** tab (the accounts behind those posts).

What differs is *how* the feed and members are produced. That variation is the only new
abstraction we introduce: a **`ListSource`** discriminated union describing where a feed
comes from, plus a resolver that turns any source into `{ statuses, members }`.

```
type ListSource =
  | { kind: 'user-list';   id: string }                 // existing UserList
  | { kind: 'collection';  id: string }                 // existing Collection (accounts)
  | { kind: 'saved-search';id: string }                 // SavedSearch → post feed
  | { kind: 'server-feed'; feed: 'federated'|'local'|'news' }
  | { kind: 'endorsed';    accountId: string }          // someone's endorsed accounts
```

- **Posts** come from: the list-timeline endpoint (user-list), a client-side merge of
  member timelines (collection, endorsed), the saved-search runner (saved-search), or a
  public timeline endpoint (server-feed).
- **Members** are: real members (user-list, collection, endorsed), or **distinct authors
  of the loaded posts** (saved-search, server-feed) — the "synthetic members" model.
  This matches the decision below and how post-search lists already imply their authors.

## What we already have (don't rebuild)

- **`Lists` page** (`pages/lists/`) — user lists + collections, create/delete, starter
  collection, "collections featuring me". This becomes the grouped-sections host.
- **`ListTimeline`** (`pages/list-timeline/`) — Posts/Members tabs, anonymous synthetic
  follow-feed via `AnonymousMastodonProvider.createFollowFeed`, bulk-add, convert. The
  **template pattern** (tabs + StatusCard feed + member rows) is the model every source
  reuses.
- **`CollectionPage`** (`pages/collection/`) — already merges member timelines
  client-side (`forkJoin(getAccountStatuses…)`, `FEED_PER_MEMBER`/`FEED_MAX`). This is
  *exactly* the algorithm the "endorsed accounts" source needs — extract & share it.
- **`SavedSearches`** service + `MawkingbirdSearch` rich object + `applySearch()` runner
  in `search.ts`. Saved searches exist and re-run; they just aren't listable as feeds.
- **`accountEndorsements(id)`** API (`GET /accounts/:id/endorsements`) — profile already
  loads featured/endorsed accounts (`profile.ts loadFeatured`). No new endpoint needed.
- **Server feeds**: `PublicTimeline` page + `Api` public/federated/local timeline calls,
  and trending (`trendingStatuses`). "News" = a designated feed (trends or a curated tag).
- **Right rail** links `/explore` + `/public`; **left rail** owns trends now.
- **Account-scoped localStorage** (`scopedKey`) — home for any new client-side prefs, per
  the [[mockingbird-client-side-constraint]] rule (features must work vs mastodon.social;
  prefs in localStorage).

## Decisions taken (from Matthew, 2026-07-21)

1. **Grouped sections layout.** One Lists page, labeled stacked sections in this order:
   **Lists · Saved searches · Server feeds · Collections · Endorsed accounts**. Lowest
   risk, closest to today's page, fully scannable. No flat-list badges, no sub-tabs.
2. **Server-feed synthetic members = distinct authors of loaded posts.** Members grow as
   you scroll; honest and fully client-side. Same derivation as saved-search lists. Every
   list keeps a Members tab — uniformity preserved.
3. **Keep `/explore` alive but orphan it.** The route stays; nothing in the main app links
   to it after Sprint 2. Server feeds surface in the Lists tab and still appear on the
   right rail, but those rail links now point at the Lists-tab feed views, not `/explore`.
   We evaluate the new arrangement before deleting anything.
4. **Feed views are read-only where membership isn't real.** Server feeds and saved-search
   feeds have no "add member" affordance; endorsed-account feeds are read-only mirrors of
   the profile's endorsement set (managing endorsements stays on the profile). Only real
   user-lists/collections keep bulk-add and member removal.

## The one architectural constraint (already how we live)

Everything must work against real **mastodon.social** with only client-side state
([[mockingbird-client-side-constraint]]). There is **no** collection-timeline or
saved-search-timeline endpoint on the server — those feeds are synthesized in the browser
(as `CollectionPage` already does). Anonymous mode has its own capability limits
([[mastodon-social-anonymous-endpoints]]: public timelines 422 anonymously; trends and tag
timelines are open — the server-feed sources must degrade to what anonymous can actually
fetch, reusing the `AnonymousMastodonProvider` pattern rather than faking data).

## Sprints

- **[[lists-1-source-abstraction]]** — Introduce `ListSource` + a `ListFeedResolver`
  service; refactor `ListTimeline` + `CollectionPage` to route through it (extract the
  shared client-side member-merge from `CollectionPage`). Net behavior unchanged — a
  pure refactor that gives every later source a single home. Ships with the resolver's
  unit tests as the contract.
- **[[lists-2-sections-and-server-feeds]]** — Rebuild the Lists page as grouped sections;
  add **saved-search** and **server-feed** rows that open the unified feed view with
  synthetic (author-derived) members. Re-point right-rail server-feed links into the
  Lists tab; orphan `/explore`.
- **[[lists-3-endorsed-lists]]** — Add **endorsed-account** lists: a synthetic list whose
  members are an account's endorsements and whose feed is the merged member timelines
  (reusing Sprint 1's extracted merge). Surface an "Endorsed accounts" section and a link
  from profiles' featured strip into the list view.

## Risks / watch-items

- **forkJoin latency trap** ([[rich-account-search]]): merging N member timelines is fast
  against the mock but slow against real mastodon.social. Keep `FEED_PER_MEMBER`/`FEED_MAX`
  caps; cap merged-member count (e.g. first 12) and show a "showing N of M" note.
- **Anonymous degradation**: public/federated timelines 422 anonymously. Server-feed rows
  must hide or fall back (trends/tag timelines) when `auth.isAnonymous` — reuse the
  anonymous provider, don't invent data.
- **Route surface**: new feed views should reuse existing routes where possible
  (`/lists/:id`, `/collections/:id`) and add the minimum new ones (server-feed +
  saved-search + endorsed views). Decide concrete route shapes in Sprint 2's doc.
- **Test runner**: specs run only via `npm run test:ci` ([[ui-test-runner]]); no targeted
  vitest runs.
