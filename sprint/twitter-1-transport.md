# Sprint 1 — Credentials, transport, reachability

Status: READY. Prerequisite findings are **measured, not assumed** — see below.

## Findings from live probing (2026-07-31)

Five requests against the real API with the user's key, ~36 of 10,000 bonus
credits spent. These answer the questions the rest of the plan was hedging.

### 1. TwitterAPI.io cannot be called from a browser. At all.

Not "usually blocked". Structurally impossible:

```
OPTIONS /twitter/user/info?userName=jack
  Origin: https://matthewdeanmartin.github.io
  Access-Control-Request-Headers: x-api-key
→ HTTP 401, body: "Missing API key.Please add x-api-key in header"
→ NO Access-Control-Allow-Origin header
```

The API requires `x-api-key` on **the preflight itself**. A browser never sends
credentials on a preflight — that is the entire point of one — so the preflight
can never succeed. It fails before the real request is ever attempted.

The GET does return `access-control-allow-credentials: true` but **no
`Access-Control-Allow-Origin`**, so even reaching it would not help.

Auth is header-only; there is no query-parameter escape hatch. All three
plausible spellings 403:

```
?x-api-key=… → 403    ?apiKey=… → 403    ?api_key=… → 403
```

**Consequence: the CORS proxy is not a fallback for this provider. It is the
only transport.** The "try direct first, fall back on status: 0" flow inherited
from `ShortenerTransport` is therefore *wrong here* — see Design below.

### 2. AllOrigins cannot carry this, ever.

The only free proxy that works from a deployed origin **does not forward custom
request headers**. Its preflight answer enumerates what it accepts:

```
Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type,
                              Content-Encoding, Accept
```

`x-api-key` is absent. The key is silently dropped and the target answers
`{"error":"Forbidden","message":"API key required..."}`. Since auth cannot move
to the query string (see above), there is no workaround.

It was also **26.5 seconds** for one call, versus 1.3s through CORS.SH.

### 3. CORS.SH works, end to end, verified.

Preflight:
```
OPTIONS https://proxy.cors.sh/https://api.twitterapi.io/...
→ HTTP 200
→ access-control-allow-origin: *
→ access-control-allow-headers: x-api-key      ← exactly what we need
→ access-control-max-age: 600
```

Real request: HTTP 200, correct JSON body, `Access-Control-Allow-Origin: *`,
1.27s. It forwarded the key header untouched.

Note it answered without a CORS.SH key from this origin; the catalog's
`keyRequired: true` is still the right default, since keyless access is
rate-limited and not guaranteed.

### 4. The response shape differs from the spec's predictions.

Real `/twitter/user/info` payload (captured, sanitized, → fixture):

```json
{ "status": "success", "msg": "success",
  "data": { "id": "12", "name": "jack", "userName": "jack",
            "isVerified": false, "isBlueVerified": true, "verifiedType": null,
            "followers": 10704792, "following": 3,
            "statusesCount": 30825, "mediaCount": 2973,
            "favouritesCount": 40018,
            "createdAt": "2006-03-21T20:50:14.000000Z",
            "profilePicture": "…", "coverPicture": "…",
            "protected": false, "canDm": true,
            "pinnedTweetIds": ["1833951636005552366"], … } }
```

Differences from the spec's §8.2 guesses, all of which would have been bugs:

| Spec assumed | Actually |
|---|---|
| `msg` unmentioned | envelope is `{status, msg, data}` |
| `followersCount` / `followingCount` | `followers` / `following` |
| `postsCount` | `statusesCount` |
| `bannerUrl` | `coverPicture` |
| `avatarUrl` | `profilePicture` |
| `isProtected` | `protected` |
| `pinnedPostIds` | `pinnedTweetIds` |
| ISO-8601 or Twitter's `Mon Jan 12 …` | `2006-03-21T20:50:14.000000Z` (6-digit µs) |

`id` is correctly a **string** — the spec's §8.1 warning holds.
`createdAt`'s 6-digit fractional seconds parse fine in `Date.parse`, but the
normalizer must not assume 3.

`isVerified` and `isBlueVerified` are genuinely independent here (jack is blue
but not legacy-verified), which is exactly why §8.2 says keep both.

## Design consequences

### The transport is proxy-first, not proxy-fallback

`ShortenerTransport` tries direct every time because shorteners *vary* — some
answer browsers. TwitterAPI.io provably never will, so trying direct first would
burn a guaranteed-failed request and several seconds on every single call.

`TwitterTransport` therefore:

- **Requires a configured, consented proxy before it will issue anything.** With
  none, it throws `TwitterProxyConsentRequired` immediately, having spent no
  time and no money.
- Still performs the direct probe **exactly once**, from the connector page's
  Test button, so the claim "this service refuses browsers" is something the
  user *watches happen* rather than something the app asserts. That satisfies
  the user's requirement that they affirmatively see it fail. The result is
  cached in settings; it is not re-probed per request.

### AllOrigins must be excluded for this connector

Offering a proxy that cannot possibly work is the same sin the catalog already
calls out for `devOnly` entries. The catalog gains:

```ts
/** Whether this proxy forwards non-safelisted request headers to the target. */
forwardsCustomHeaders?: boolean;
```

`false` for AllOrigins (measured). `true` for CORS.SH (measured). Unknown for
the dev-only two and for `custom` — treat `undefined` as "unproven", show it as
such, and let the Test button settle it.

The Twitter connector's proxy picker filters to
`forwardsCustomHeaders !== false`, and explains why AllOrigins is missing rather
than silently hiding it.

### Proxy survey — all candidates measured 2026-07-31

Every proxy tested against the real target, checking the one property that
decides this: **does `X-API-Key` survive the hop?**

| Proxy | Verdict | Evidence |
|---|---|---|
| **Corsfix** | ✅ **Best.** 0.77s | Forwards the key; preflight returns `Access-Control-Allow-Headers: x-api-key`. Free tier is *allowlist*-based, not localhost-only. |
| **CORS.SH** | ✅ Works, 1.3–1.8s | Forwards the key from a deployed origin; preflight allows `x-api-key`. |
| AllOrigins | ❌ Cannot ever | Strips custom headers. Also 26.5s. |
| WhateverOrigin | ❌ Defunct | `/get?url=…` returns its own marketing HTML for every target, incl. `example.com`. Not a header problem — it no longer proxies. |
| cors.lol | ❌ Unusable | HTTP 429 on essentially every request from a residential IP, including the first of a session. Header behaviour could not even be established. |
| CORS Anywhere (demo) | ❌ Gated | 403 "See /corsdemo": requires a human to click an activation page, and the grant is temporary. Self-hosting is the `custom` entry, not a distinct service. |

**The Corsfix correction matters.** It was catalogued `devOnly` and hidden from
the picker in production — on the belief its free tier was localhost-only. It is
not: localhost is merely allowed *implicitly*, and any other origin works once
registered in their dashboard. Its 403 from an unregistered origin is
`{"corsfix_error":"domain_not_registered"}` — a setup instruction, not a fault.
So the app had been hiding the fastest free option that exists for this job.

### Catalog changes (DONE — implemented ahead of the rest of Sprint 1)

- `CorsProxyEntry.forwardsCustomHeaders?: boolean` — `false` AllOrigins, `true`
  CORS.SH + Corsfix, `undefined` (unproven, offered but labelled) for `custom`.
- `CorsProxyEntry.originAllowlist?: { dashboardUrl, note }` — for Corsfix, so
  `domain_not_registered` renders as "register your domain here" instead of a
  bare 403.
- `headerCapableCorsProxies()` — the picker for any key-carrying connector.
  Excludes only a measured `false`; unproven entries stay in.
- Corsfix `devOnly` removed; `keyHeader: 'x-corsfix-key'` added.
- The two dead services are recorded as a comment in the catalog rather than
  silently omitted — they are the top hits when anyone searches for a free CORS
  proxy, and the next person deserves the negative result.

Still worth doing: a paste-able **Cloudflare Worker** snippet in the docs for
`custom`, now that "bring your own" is the only rate-limit-proof answer.

## Status: transport layer COMPLETE (2026-07-31)

Built and verified. `providers/twitter/`:

| File | What |
|---|---|
| `twitter-source.ts` | Catalog of the two services; `implemented` gates the picker so GetXAPI can't be selected before its adapter exists. |
| `twitter-settings.ts` | Active source + per-source keys, split config/secret storage, retention policy, persisted probe verdict. |
| `twitter-errors.ts` | §10 error model, status mapping, and `providerErrorInBody` for the HTTP-200-wrapping-an-error case. |
| `twitter-transport.ts` | Proxy-first request path, §11 retry, plus the single direct `probeDirect`. |
| `twitter-reachability.ts` | The Test-button probe: direct, then proxy, with verdicts that never guess a cause. |
| `../proxy-consent-store.ts` | `ProxyConsent`, generalized from the shortener's, with migration. |
| `fixtures/user-info.json` | Real captured response (sanitized, public account). |

**Verified end to end against the live API**: the exact URL `buildUrl()` builds,
wrapped in the exact CORS.SH template from the catalog, with the exact header
`TwitterSettings.resolve()` produces → HTTP 200, real data, 0.7s.

Suite: 2380 passing (76 new). Build clean; bundle +0.6 kB.

### Design notes worth keeping

- **`ShortenerProxyConsent` survives as a narrowing facade** over the shared
  store rather than being deleted. It keeps the shortener call sites typed to
  `ShortenerId` (so a Twitter id cannot be passed by mistake) and keeps
  `revokeAll()` meaning "the shortener's grants", not everyone's.
- **The probe verdict lives with the config, not the key.** It is a fact about
  the *service*, so it survives key rotation and must outlive the key ageing out.
- **Nothing is sent before consent exists.** Not even a doomed direct request —
  an unconfigured app costs zero requests and zero seconds. Guarded by spec.

## Work items

1. `TwitterSettings` — `ShortenerSettings` shape: split config/secret keys,
   `stampCredential`, `ExpiringConnection`, browser scope.
2. `TwitterTransport` — proxy-first per above; §11 retry (max 3, full jitter,
   honour `Retry-After`); `externalFetch()` context.
3. `TwitterApiError` + §10.1 status mapping, **including HTTP-200-with-error-body**
   — confirmed real: the AllOrigins attempt returned HTTP 200 wrapping a
   `{"error":"Forbidden"}` payload. This is not hypothetical.
4. `api.twitterapi.io` + `api.getxapi.com` → `CREDENTIAL_HOSTS` in `cors-proxy.ts`.
5. ~~`forwardsCustomHeaders` on `CorsProxyEntry`~~ — **done**, with
   `originAllowlist`, `headerCapableCorsProxies()`, the Corsfix `devOnly`
   correction, and specs. Suite green (2304 tests).
6. Connector catalog entry + lazy route `/settings/connections/twitter`. Its
   proxy picker uses `headerCapableCorsProxies()` and surfaces
   `originAllowlist.note` when Corsfix returns `domain_not_registered`.
7. `TwitterReachability` — the one-shot direct probe plus a proxied probe,
   reporting which legs work. Budget: 2 requests, labelled as such.
8. Fixtures from the captured payloads above.

## Cost

Measured: 1 credit per `/twitter/user/info` call at this account's rate
(~10,000 credits for the $0.10-equivalent bonus grant). The probe costs 2. Unit
tests cost nothing — they run against fixtures.
