# Roadmap — X/Twitter via scraper services (GetXAPI, TwitterAPI.io)

Status: ACCEPTED (2026-07-31). Grounded in
`spec/ui/twitter_by_scraper_services.md` and in what this codebase already has.

## Decisions (user-confirmed 2026-07-31)

1. **TwitterAPI.io is the first source.** Better documented, has list-posts
   (GetXAPI documents none), and per-record pricing keeps a failed call cheap.
   GetXAPI follows in Sprint 6 against the same interface.
2. **Followed accounts live in the Lists tab**, as a new
   `ListSource` kind — not merged into home on day one. Reuses
   `ListFeedResolver` and the list-timeline page rather than inventing a fourth
   "a feed" pattern.
3. **Cautious cost posture.** Anything costing more than one request shows an
   estimate and needs a click. Follow cap ~10, matching RSS. Daily soft limit on
   by default.
4. **Hand-written type guards, no Zod.** No new runtime dependency.

## What the spec asks for vs. what Mockingbird is

The spec was written for a generic Angular client with the option of a backend.
Mockingbird has no backend and will not grow one (standing constraint: every
feature must work client-side against real mastodon.social). That deletes whole
sections of the spec and changes the shape of the rest:

| Spec section | Verdict here |
|---|---|
| §5.2 application-owned key / BFF proxy | **Out.** No backend, ever. §5.1 user-supplied key only. |
| §5.3 "don't make CORS a hard dependency" | Inverted: CORS *is* the dependency, and the CORS proxy is the mitigation we already ship. |
| §4 four-layer architecture (`SocialProvider`, `SocialProfile`, `SocialPost`) | **Rejected as written** — see below. |
| §7.1 true home timeline | Out (spec agrees). |
| §7.2 local following feed | In, and it is the headline feature. |
| §2.2 mutations | Out (spec agrees). Follow = local subscription only. |
| §21 phases | Re-cut into the sprints below. |

### Why the spec's data model is rejected

The spec proposes `SocialProfile` / `SocialPost` / `Page<T>` as the app's shared
vocabulary. Mockingbird already has one: **Mastodon `Status` and `Account`**.
Every card, thread view, reader mode, filter, local-moderation check and
human-time pipe in the app speaks it. RSS, Bluesky and the paste providers all
adapt *into* it at the edge (`providers/rss/rss-adapter.ts`,
`providers/bluesky/bluesky-adapter.ts`), and the roadmap that established that
pattern (`sprint/roadmap-providers.md`) is explicit that nothing outside
`providers/` learns another protocol exists.

Introducing a second normalized model would mean either two card components or a
`SocialPost -> Status` shim, i.e. two adapters where one will do. So:

- **The spec's normalized types become the adapter's *internal* wire-neutral
  layer**, living in `providers/twitter/`, never escaping it.
- `ProviderId` gains `'twitter'`. Ids are namespaced `twitter:<postId>` /
  `twitter:@<username>`, per the existing convention.
- Everything §8 says about **IDs as strings**, timestamp normalization, entity
  handling and recursion-depth guards is kept verbatim — those are correctness
  requirements, not modelling preferences.
- `Page<T>` collapses into the existing `FeedProvider.reset()/fetchPage()`
  contract plus a per-source cursor held inside the adapter.

The two-provider abstraction (`TwitterSource` interface, two adapters behind it)
**is** kept — that part of the spec is right, and the endpoint tables differ
enough between GetXAPI and TwitterAPI.io to justify it.

## What already exists that this plugs into

Nothing here needs inventing; it needs wiring.

| Need | Existing machinery |
|---|---|
| Store an API key, browser-scoped, with retention/expiry | `ShortenerSettings` / `CorsProxySettings` pattern: split config/secret localStorage keys, `stampCredential`, `ExpiringConnection`. |
| Several services, one active, keys kept per service | `ShortenerSettings` exactly — `active` id + `keys` map. |
| CORS proxy with a credential | `CorsProxy.proxyCredentialedRequest(url, consented)`, gated on a recorded consent. |
| Consent UI that names the operator and the concrete risk | `ProxyConsentDialog` + `ShortenerProxyConsent` (needs generalizing — see Sprint 2). |
| Try direct, fall back to proxy on `status: 0`, never silently | `ShortenerTransport.request()` — the exact shape needed here. |
| A connector page + catalog card | `connections/connection-catalog.ts` + a lazy child route. |
| Read-only content in the timeline | `FeedProvider`, `ProviderRegistry`, `FeedAggregator`, capability gating in `StatusCard`. |
| Per-account subscription list with cap + enable/disable | `RssSubscriptions` (scopedKey, limit, enabled flag). |
| Feed caching with TTL and failure cooldown | `RssCache` / `RssFetch` (IndexedDB). |
| Cost/usage visibility | `CorsProxyUsageStore`, `ApiMetrics` + `/observability`. |

The one genuinely new thing is **cost**: every request is billed. Nothing in the
app has had that property before, and it drives the design of Sprint 5.

## The blocking constraint: CORS — MEASURED, not assumed

Probed against the real API on 2026-07-31 with a live key. Full evidence in
`twitter-1-transport.md`. The short version:

- **TwitterAPI.io can never be called from a browser.** Its preflight demands
  the `x-api-key` header that a preflight cannot carry, and answers 401 with no
  `Access-Control-Allow-Origin`. There is no query-param auth fallback (all
  three spellings 403). This is not a policy that might change; it is a server
  never configured for browsers.
- **AllOrigins — the only free proxy that works from a deployed origin — cannot
  carry it either.** It does not forward custom request headers
  (`Access-Control-Allow-Headers` omits `x-api-key`), so the key is silently
  dropped. Also 26.5s per call.
- **CORS.SH works, verified end to end.** Preflight returns
  `access-control-allow-headers: x-api-key`; the real call returns correct data
  in 1.3s.

So the proxy is **the only transport**, not a fallback — which inverts the
`ShortenerTransport` flow. Trying direct on every request would burn a
guaranteed failure each time. Instead:

1. The connector page's **Test** button probes direct **once**, so the user
   *watches* it fail rather than being told it will. This is what satisfies the
   "user must affirmatively see that the service doesn't work without a CORS
   proxy" requirement.
2. The verdict is stored. Ordinary requests go proxy-first and never retry
   direct.
3. With no consented proxy, `TwitterTransport` throws
   `TwitterProxyConsentRequired` immediately — no time, no money spent.
4. The disclosure names the stake: **the proxy operator can read your X API key
   and spend your credits, and can see every profile and search you look up.**
5. Only after a recorded `(provider, proxy)` consent does anything go through
   `proxyCredentialedRequest`.

**Proxy catalog impact.** `CorsProxyEntry` gains `forwardsCustomHeaders`;
AllOrigins is `false` (measured) and must be filtered out of this connector's
picker, with the reason shown rather than the option silently hidden. CORS.SH is
the only shipped entry that works, so the Cloudflare Worker recipe under
`custom` stops being an escape hatch and becomes a documented first-class path.

---

## Sprints

Sprints are sized so each one ends with something demonstrable and green specs.
Sprints 1–4 are the "day one" the user described; 5+ are follow-ons.

### Sprint 1 — Credentials, transport, and a reachability probe
`sprint/twitter-1-transport.md`

No feed content yet. Ends with: a connector page where you paste a key, press
**Test**, and get an honest verdict — works directly / needs a proxy / key is
bad / out of credits.

- `TwitterSettings` (modelled on `ShortenerSettings`): `active: TwitterSourceId`
  + per-source keys, split config/secret keys, `stampCredential`,
  `ExpiringConnection`. Browser-scoped (`scope: 'browser'`) — the subscription
  belongs to whoever pays, same as OpenRouter.
- `TwitterTransport`: direct-then-consented-proxy, the retry policy from §11
  (max 3, full jitter, honour `Retry-After`, never retry a non-idempotent call —
  though every call here is a read), `externalFetch()` context so the Mastodon
  interceptor keeps its hands off.
- `TwitterApiError` + status mapping (§10.1), **including the HTTP-200-with-
  error-body case** (§10 "Do not treat HTTP 200 alone as success").
- Add `api.getxapi.com` and `api.twitterapi.io` to `CREDENTIAL_HOSTS` in
  `cors-proxy.ts` — mandatory, and it goes in this sprint so the ordinary proxy
  path refuses them from the very first commit.
- Connector catalog entry + lazy route `/settings/connections/twitter`.
- `TwitterReachability` probe, modelled on `ShortenerReachability`: one cheap
  call (profile lookup of a fixed public handle), reports which leg worked.

**Cost note:** the probe is one billable request. The page says so before you
press it.

### Sprint 2 — Proxy consent, generalized
`sprint/twitter-2-consent.md`

The consent machinery currently says `ShortenerId` in its types. Twitter needs
the same thing with different copy and a materially higher stake (an X key buys
credits; a shortener key makes links).

- Generalize `ShortenerProxyConsent` → `ProxyConsent` keyed by
  `(connectorId, proxyId)`, with `ShortenerId | TwitterSourceId` as the
  connector. Migrate the existing localStorage key with a read-time fallback so
  nobody loses a grant.
- Generalize `ProxyConsentDialog` to take a `{ label, keyPowers: string[] }`
  descriptor instead of a `ShortenerCatalogEntry`. Twitter's `keyPowers`:
  *"spend the credits on your account"*, *"see every profile, search and post
  you look up"*.
- The dialog must state the second one plainly. Routing X lookups through a
  proxy discloses the user's reading habits to the proxy operator — that's a
  privacy cost the shortener case didn't have, and §19 requires disclosing it.
- Connector page lists and revokes grants (the link-shortener page already does
  this; reuse its section).

### Sprint 3 — One source, read paths, adapters
`sprint/twitter-3-adapter.md`

Ends with: you can look up a profile and see that person's posts rendered as
ordinary Mockingbird cards.

- `providers/twitter/` layout per §17: `twitter-source.ts` (the interface),
  `getxapi/` and `twitterapi-io/` each with `-wire-types.ts`, `-schemas.ts`,
  `-normalizers.ts`, `-source.ts`.
- **Validation is hand-written type guards, not a new dependency.** §10.2 wants
  runtime validation and names Zod; adding a validation library to this app for
  one provider is not worth the bundle. Guards return
  `PROVIDER_CHANGED` with the missing field names, never a raw `TypeError`.
- Implemented in this sprint, **TwitterAPI.io only**: `getProfile`
  (`/twitter/user/info?userName=`), `getUserPosts`
  (`/twitter/user/tweet_timeline?userId=`, falling back to
  `/twitter/user/last_tweets?userName=` before the first ID resolution), and
  `searchPosts` (`/twitter/tweet/advanced_search?query=&queryType=Latest`).
  Parameter names are taken from the provider's current docs at implementation
  time, per §23 — the spec's own tables are explicit that they may have drifted.
- `twitter-adapter.ts`: normalized post → Mastodon `Status`, normalized profile →
  `Account`. Entities → the HTML `content` field the cards already render
  (mentions/hashtags/links as `<a>`, matching how `bluesky-facets.ts` builds
  HTML from facets). Media → `media_attachments`. Quote → `quote`. Repost →
  `reblog`. Depth guard at 2 per §8.3.
- Cache: reuse the `RssCache` IndexedDB pattern with §13's TTLs (profile 6h,
  first timeline page 30–120s). **Cost makes caching load-bearing, not an
  optimization** — a cache miss is money.
- Full unit coverage per §18.1 with fixtures per §18.2, written by hand from
  the documented shapes since we have no key yet.

**Sprint 3 status: COMPLETE (2026-07-31).** `providers/twitter/twitterapi-io/`
holds wire types, guards and normalizers, all written against captured live
responses. 43 unit tests.

Validated against a *fresh* live response from an account not in the fixtures
(ESA, 20 posts, fetched through the real CORS.SH path) — the adapter was run
over data nobody had curated:

```
posts: 20   skipped: 0   undatedPosts: 0   emptyContent: 0
withMedia: 13   reblogs: 6   badIds: 0   badAccounts: 0
unrenderedTco: 0   unescaped: 0   cursorPresent: true
```

Nothing dropped, nothing mis-dated, no leftover `t.co` shorteners in rendered
text, no unescaped HTML, and pagination available. Field-name corrections the
capture-first approach caught are listed in `twitter-1-transport.md` §4 and in
the Sprint 3 commit message.

### Sprint 4 — Follows and the Twitter feed
`sprint/twitter-4-follows.md`

Ends with: the "follow @so_and_so" form on the connector tab works, and followed
accounts show up as feeds.

- `TwitterFollows` (modelled on `RssSubscriptions`): account-scoped
  (`scopedKey`), capped at 10 like RSS, `{ userId, username, displayName,
  addedAt, enabled }`. Stores the **numeric user ID** on first resolution, per
  §6.5 — it is stable across renames and skips a lookup on every fetch.
- Follow form on the connector page: type a handle → resolve profile (1 request,
  and the button says so) → show the profile card → confirm → stored.
- **Feeds land in the Lists tab.** `ListSource` gains
  `{ kind: 'twitter-account'; userId: string }`; `ListFeedResolver` resolves it
  by calling `getUserPosts` and adapting to `Status[]`; members are synthetic
  (`memberOrigin: 'synthetic'`, one author). Each follow appears as a row on the
  Lists hub, so the existing list-timeline page renders it with no new page.
- **No home-timeline merge on day one.** `TwitterProvider` is written against
  `FeedProvider` so the merge is a one-line registry change later, but it is not
  added to `ProviderRegistry.all` in this sprint — an unbounded home refresh
  across N followed accounts is exactly the cost blowout Sprint 5 exists to
  prevent, and it should not ship before those controls do.
- Capability gating: `PROVIDER_CAPS.twitter = { reply: false, favourite: false,
  reblog: false }` — cards show "Open on X ↗", exactly like RSS.
- Provider badge (🐦 or 𝕏) on cards; filter chip when merging lands.

### Sprint 5 — Cost controls and honesty
`sprint/twitter-5-cost.md`

Cautious posture, per the decision above: the app's job is to make it impossible
to spend money by accident.

- `UsagePolicy` (§14) with the spec's defaults; a request counter per day held
  in localStorage; soft warning and hard stop.
- **Any action costing more than one request shows an estimate and needs a
  click** — "Refresh all 12 followed accounts ≈ 12 requests. Continue?". A
  single-request action (one profile lookup, one page of one timeline) just
  labels its cost on the button and goes.
- No "relax the gates" toggle in this sprint. If the confirmations turn out to
  be genuinely annoying in daily use, that is the moment to add one, with the
  evidence in hand.
- Surface it in `/observability` next to the existing API metrics — that page
  already exists for exactly this kind of question.
- Pricing metadata as data (§14), not constants, with an `effectiveDate` so a
  stale number is visibly stale.

### Sprint 6 — Second source, and parity
`sprint/twitter-6-second-source.md`

- **GetXAPI**, against the same `TwitterSource` interface. Its endpoint set is
  the richer one (dedicated `tweets_and_replies`, `media`, `thread`,
  `retweeters`, `trends`), so this sprint is also where several §21-Phase-2
  capabilities first become reachable.
- Capability reporting (§4.1) so the UI can grey out what the active source
  can't do — TwitterAPI.io has list posts, GetXAPI documents none.
- Manual fallback UI (§15): never automatic on auth/credit/not-found; offered on
  network and 5xx only, with the "you are now telling two companies what you
  searched for" note.

### Sprint 7+ — The rest of the spec
Threads/conversations, followers/following, user search, media timeline, list
members and list posts, trends, merging into the home timeline behind a filter
chip, the local following feed with high-water marks and concurrency limits
(§7.2). Each is small once Sprints 1–4 exist.

The home-timeline merge specifically should not land before Sprint 5 ships: it
is the one feature that turns idle scrolling into recurring spend.

---

## Testing

Per `spec` §18 and this repo's constraints:

- Unit tests for normalizers and error mapping, fixture-driven. Fixtures are
  hand-written from the documented shapes until a key exists, then replaced with
  sanitized real captures.
- **No live integration tests in CI.** They cost money. §18.3's opt-in suite
  becomes a script gated on an env var, run by hand, with a hard request budget.
- UI specs run only via `npm run test:ci`.
- **Coding from spec without a key is the accepted risk of Sprints 1–4.** The
  mitigation is structural rather than optimistic: every parameter name and
  response shape lives in exactly one adapter file (§23), validation failures
  produce `PROVIDER_CHANGED` naming the missing fields rather than a crash, and
  the reachability probe is built in Sprint 1 so the very first thing a key can
  do is tell us how wrong the guesses were. Expect the first real key to produce
  a short, contained correction pass in the normalizers — not a redesign.
