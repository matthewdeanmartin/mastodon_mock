# Anonymous Mastodon — Sprint 8: reliable anonymous reading

Status: COMPLETE (implemented and verified 2026-07-19)

## Product premise

Mockingbird should provide the read-only majority of a Mastodon experience without an account.
Public discovery, profiles, posts, hashtag timelines, local follows, and local lists do not require
server-side identity. Authentication should be requested at the point where a user tries to publish
or interact, not while they are reading public material.

This sprint replaces the previous sprint direction. It is deliberately limited to the three broken
reader journeys observed in the current UI:

1. A local list can show its members but not their blended posts.
2. A profile found through search can show posts while the same account is blocked in Home or a list.
3. Anonymous search can find hashtags, but clicking a hashtag is redirected to “unavailable.”

## What the code audit found

### The list UI is present; its acquisition route is unreliable

`ListTimeline` already builds an independent, paged feed from the list's browser-local member keys.
The member tab succeeds without a network request because it reads account snapshots from
`AnonymousFollows` in localStorage.

The post tab uses `AnonymousMastodonProvider.createFollowFeed()`. When an account is followed,
`AnonymousFollows.follow()` throws away the instance through which the account was successfully
discovered and rewrites the read source to the account's canonical home server. The feed then does a
new cross-origin account lookup and status request against that server. If that API request is blocked,
it tries the profile's RSS URL directly. RSS is also fetched cross-origin and commonly lacks browser
CORS permission, so both routes can fail even though the selected Mastodon instance can already serve
the profile and its posts anonymously.

This same source rewrite explains why a search profile can work while Home and list feeds fail.

### API-first is already intended, but it starts from the wrong API route

`AnonymousMastodonProvider.fetchSource()` currently tries a public Mastodon API and falls back to RSS.
The ordering is correct in principle. The missing information is the successful acquisition reference:
the instance used for search/profile discovery and that instance's local account id. Without it, the
provider unnecessarily changes hosts before loading the feed.

The persisted `preferredSource`/`apiRetryAfter` state also remembers a failed route, rather than which
API routes were attempted. It needs to be made route-aware so one CORS failure does not suppress a
different public API route that may work.

### Hashtag reading is implemented but route-guarded off

The tag page already fetches `/api/v1/tags/:tag` and `/api/v1/timelines/tag/:tag`, provides a local
anonymous Follow toggle, and has component tests. However, `app.routes.ts` still applies
`anonymousUnavailableGuard` to `tags/:tag`. Hashtag search results therefore navigate to an explicit
“Tag search unavailable” redirect before the working component can load.

### The tests prove helpers, not the failing journeys

Provider tests cover canonical API lookup, API-to-RSS fallback, partial source failure, and independent
list cursors. The list component tests cover only authenticated HTTP lists. Tag component tests cover
the timeline component but do not exercise the anonymous route configuration. There is no journey test
that starts with an anonymous search result, follows it, adds it to a list, and verifies the same public
posts appear in Profile, Home, and the list.

## Goal

Make every explicitly requested anonymous reader view use the most reliable public path already known
for an object, with transparent API-to-API-to-RSS fallback and no authenticated mutation, polling, or
background collection.

## Source policy

For an account followed from search or a public profile, persist two separate concepts:

- **Canonical identity:** the federated handle/profile URL used for deduplication and local relationships.
- **Read reference:** the instance and instance-local account id that successfully returned the account.

Fetch public posts in this order:

1. The stored read reference: `GET {discovery instance}/api/v1/accounts/{local id}/statuses`.
2. The canonical account instance: anonymous lookup followed by the public statuses endpoint.
3. The canonical public profile RSS feed.

RSS is a last resort, never a preferred source merely because a prior page load failed. A successful API
route becomes the saved read reference. Backoff applies to the failing route, not to the whole account.
Failure of one member never discards successful members in the same Home or list page.

## Stories

### S8.1 — Preserve public read references

- Extend `AnonymousFollow` with a validated, persisted read reference containing origin and account id.
- Pass the active public-profile/search origin into `follow()` rather than deriving all acquisition data
  from `account.url`.
- Keep the canonical follow key unchanged so lists and unfollow state remain stable.
- Bump the anonymous follow/list storage versions and discard incompatible older social-graph state. Anonymous local
  storage is explicitly disposable during this pre-user development phase; schema migration/versioning
  policy belongs on the roadmap, not in this functionality sprint.

Acceptance:

- Following an account returned by the selected instance persists both its canonical identity and the
  selected-instance read reference.
- Incompatible older follow and list records are replaced cleanly instead of being partially interpreted.
- Two different instance-local ids for the same federated account remain one local follow.

### S8.2 — Implement route-aware public API fallback

- Extract account-post acquisition into a small provider-owned source resolver.
- Try the stored read reference first, canonical anonymous API second, and RSS third.
- Update the saved read reference after any successful API route.
- Track retry/backoff per route; an RSS result may satisfy the current page but must not permanently
  replace API as the default.
- Keep bounded concurrency, per-source cursors, canonical post deduplication, and partial-success merge.
- Surface compact diagnostics that name the failed stage: discovery API, canonical API, or RSS/CORS.

Acceptance:

- An account whose profile posts load through the selected instance also loads in Home and local lists.
- If the stored reference becomes stale, canonical API succeeds without attempting RSS.
- RSS is requested only after both viable anonymous API paths fail.
- One failed member cannot make healthy Home or list members disappear.
- Manual retry clears only the relevant route backoff and performs no background work.

### S8.3 — Open anonymous hashtag search and timelines

- Remove the anonymous guard from `tags/:tag`.
- Keep tag metadata optional: timeline success is enough to render the page.
- Make hashtag search and tag timeline reads explicitly public, token-free operations on the selected
  instance.
- Adapt returned statuses with stable anonymous source references so profile/thread links continue to
  work if the selected instance later changes.
- Add explicit Load more pagination to the tag page using the last native status id.
- Continue to store hashtag follows locally; do not call follow/unfollow/feature mutations anonymously.

Acceptance:

- An anonymous hashtag search result opens its public timeline instead of `/unavailable`.
- Direct navigation to `/tags/:tag` works anonymously.
- Follow/unfollow changes only browser-local tag state.
- Status, author, and thread links from the tag timeline remain readable and token-free.
- A metadata 404 does not hide a successful public timeline.

### S8.4 — Add reader-journey regression coverage

- Add an anonymous list component test with two members: one succeeds through its stored read reference
  and one fails all routes; verify the successful posts render with a warning for only the failed source.
- Add provider tests for stored-reference success, stale-reference canonical fallback, RSS-last ordering,
  route-scoped backoff, and incompatible-storage replacement.
- Add router coverage proving `tags/:tag` is available anonymously while interaction-only routes remain
  guarded.
- Add a search-to-profile-to-follow-to-list integration-style test using one account object across the
  complete reader journey.
- Assert all external public reads carry the external-fetch context and no Authorization header.

Acceptance:

- The tests fail against the current implementation for the three reported journeys.
- The tests distinguish “member metadata is visible” from “member posts were actually acquired.”
- Authenticated Mastodon behavior is unchanged.

## Suggested delivery order

1. Write the failing journey tests and the incompatible-storage replacement fixture.
2. Add the read-reference model and bump the storage version without changing fetch behavior.
3. Replace source selection with the route-aware API/API/RSS resolver.
4. wire Home and list sessions through the resolver and improve warnings.
5. Remove the hashtag route guard, adapt/paginate tag results, and add router coverage.
6. Run the UI format, lint, test, and both production builds; manually smoke-test with at least two
   real Mastodon instances whose CORS behavior differs.

## Sprint exit criteria

- The three reported anonymous reader journeys work end to end.
- Public API is preferred over RSS, and RSS is demonstrably last in the request sequence.
- Incompatible anonymous follow/list state is reset cleanly; schema migration is not implemented.
- No token is attached to cross-instance public reads.
- No compose, reply, favourite, boost, vote, report, server follow, or other identity mutation is enabled.
- No polling, streaming, scheduled refresh, or unbounded fan-out is added.
- `npm run format:check`, `npm run lint`, `npm test -- --no-watch`, `npm run build`, and
  `npm run build:mockingbird` pass.

## Product decisions

1. Mockingbird automatically remembers a newly successful API route locally per follow.
2. Tag timelines use the selected Anonymous instance only, avoiding hidden fan-out and duplicate-heavy
   results.
3. When all routes fail, Mockingbird shows a precise warning rather than silently inserting stale posts.
4. Incompatible localStorage schemas are replaced during pre-user development. Durable schema migration
   and user-data preservation policy are roadmap work.

## Deferred

- Background refresh, polling, and streaming.
- A multi-instance merged hashtag firehose.
- Offline/stale-while-revalidate feeds.
- Anonymous replies, favourites, boosts, polls, reports, or any other server mutation.
- Local-data export/import and multiple Anonymous identities.
- Durable local-state schema migration and recovery policy.
- Broader discovery/secondary-link polish not required by the three reader journeys above.

## Delivered

- Anonymous follows now persist the instance-local account reference that successfully discovered the
  account separately from its canonical federated identity.
- Home and local-list acquisition now tries the saved public API reference, canonical anonymous API,
  and RSS in that order, with route-specific backoff and partial-source failure isolation.
- Anonymous follow/list storage versions were bumped together. Incompatible pre-user state is replaced;
  no migration layer was added.
- Anonymous search uses an explicit token-free public client and adapts account/status results to stable
  source-instance routes.
- The stale `tags/:tag` anonymous guard was removed. Tag metadata and timelines use the public client,
  status links preserve their source instance, and explicit native-id pagination is available.
- Added regression coverage for saved read references, API/API/RSS ordering, disposable schema changes,
  anonymous list post acquisition, anonymous hashtag search/timelines, public route configuration, and
  stable source-reference adaptation.

## Verification

- `npm run lint` — pass.
- `npm run test:ci` — pass (full suite, including the final disposable list-version coverage).
- `npm run build` — pass.
- `npm run build:mockingbird` — pass.
- `git diff --check` — pass.
