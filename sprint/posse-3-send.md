# POSSE — Sprint 3: Actually send the webmention

Status: COMPLETE (implemented 2026-08-06; 3360 tests, lint, prettier and both builds clean;
94 tests added. Blog-side changes staged in `mistersql`). Roadmap: `posse-0-overview.md`.

## What changed during implementation

- **The `source` question got its answer, and it is per-interaction pages.** The plan left
  the choice open. `mistersql` now generates one page per record via a **content adapter**
  (`content/interactions/_content.gotmpl`, Hugo 0.126+), which turns the committed JSON into
  real URLs at build time with no separate generator. Each carries the microformat that
  makes a webmention count as a *like* rather than a bare mention — verified in the built
  HTML: `class="u-like-of"` and `u-repost-of` on links to the right targets.
- **Two Hugo gotchas, both caught by the build:**
  1. `AddPage`'s `path` is **relative to the section**, so `"interactions/%s"` produced
     `/interactions/interactions/…`.
  2. Setting `security.allowContent` **replaces** the default rather than extending it —
     allowing `text/html` alone locked out every Markdown page in `content/`. Both types
     have to be listed.
- **Source URLs are derived after the sort, not before.** The adapter numbers pages by
  position in the *committed* array, so an index taken while merging names the wrong page
  as soon as an existing record sorts ahead of a new one. There is a test for exactly that
  ordering.
- **Discovery is a `DOMParser` parse, not a regex.** Hand-rolling HTML matching to find one
  attribute is how you match a URL inside a comment or a `<script>`. `rel` is treated as a
  space-separated *set*, so `rel="webmention noopener"` counts and `rel="webmentions"` does
  not — substring matching gets both wrong.
- **A non-http endpoint is refused.** A hostile page advertising
  `rel="webmention" href="javascript:…"` must not become something we POST to.
- **`unsupported` distinguishes the proxy's limits from the target's.** A proxy that will
  not forward a POST at all (AllOrigins) is a configuration limit, not a refusal — calling
  it `failed` would blame the wrong party, and the message names the proxy.
- **No consent dialog, deliberately.** A webmention carries two public URLs and no secret,
  so it uses the *uncredentialed* `CorsProxy.proxyRequest` path, which refuses to carry
  credentials by construction. There is nothing to consent to disclosing — a real
  difference from Mataroa, where the proxy sees an API key.

## Still open

- **Replies are not queued from the composer.** Same as at the end of sprint 2: the model,
  the queue and the blog template all handle `reply`, but nothing puts one in. That is a
  composer change, and it wants its own sprint.
- **Delivery runs immediately after the commit, not after the build completes.** The plan
  called for gating on `HugoDeployWatch` reaching `live`, since a receiver that verifies
  will fetch the `source` and find a 404 until Actions finishes. Left out to keep this
  sprint to discovery + delivery; the wiring is a few lines and the watcher already exists.
  **Do this before relying on delivery to indieweb targets.**

Sprint 2 records your interactions on your own site. This one tells the *other* site about
them, where there is a site that can be told — and says so plainly where there is not.

## Exit criteria

1. After a batch publishes, each entry's target is checked for a webmention endpoint and,
   if it has one, sent a webmention.
2. Every entry ends in one of three honest states: **delivered**, **no endpoint**
   (the normal case), or **failed** with a reason.
3. "No endpoint" is never dressed up as success. Mastodon targets will all land here.
4. Sending never blocks or reverts publishing. A commit that succeeded stays succeeded.
5. Delivery state is visible on `/posse` and is not retried forever.

## The honest expectation, stated up front

**Most sends will report "no endpoint", and that is the correct outcome, not a failure.**
Mastodon does not accept webmentions (see the roadmap). Bluesky does not. RSS items and
tweets do not. The audience that does is people running indieweb blogs.

This shapes the UI more than the code: a red error badge on every Mastodon like would train
the user to ignore the whole feature within a day. "No endpoint" is a neutral, muted state
that means *your record is published; there was nobody to notify*.

## The protocol, both halves

**Discovery.** Fetch the target URL and look, in order:
1. HTTP `Link:` headers with `rel="webmention"`.
2. `<link rel="webmention" href="…">` in the HTML.
3. `<a rel="webmention" href="…">`.

First match wins; resolve it relative to the target URL. An empty `href` means "this URL
itself".

**Delivery.** `POST` to that endpoint, `application/x-www-form-urlencoded`, two fields:
`source` (your page — the URL on *your* site carrying the record) and `target` (theirs).
2xx means accepted. Many endpoints return `202` and process asynchronously, so a 2xx means
"queued for verification", not "verified" — do not promise more than that in the copy.

## The CORS problem, and why this sprint is last

Both halves are cross-origin requests to **arbitrary hosts that have no CORS contract with
anyone**. Discovery needs to read another site's HTML; delivery needs to POST to it. Neither
works from a browser directly, for the same reason RSS often does not.

So this sprint **requires the CORS proxy**, and inherits everything that implies:
`ProxyConsent` gating (Mataroa's flow is the model, `mataroa-api.ts:50-86`), a clear error
when no proxy is configured, and the honest admission that the proxy operator sees these
requests. They contain nothing secret — two public URLs — which makes this one of the
safest things to route through a proxy in the whole app. Say that in the consent copy; it
is a genuine difference from the Mataroa case, where the proxy sees an API key.

Per `cors-proxy-landscape` memory: free proxies are mostly localhost-only in 2026, and
AllOrigins is the one that works deployed. AllOrigins **cannot POST with custom headers**,
so it can serve discovery and probably not delivery. Expect delivery to need a
header-forwarding proxy (CORS.SH and similar), and treat "no usable proxy for sending" as a
first-class state rather than an error — the same shape as "no endpoint".

**This is why the sprint is last**: it is the least reliable part of the feature, and
everything valuable — the durable record on your own site — already works without it.

## Where `source` comes from

The webmention's `source` must be a URL on your site that contains the target link with the
right microformat. Sprint 2 writes entries into `data/interactions/YYYY-MM-DD.json`, and
`data/` files have no URL of their own — so **sprint 1's blog templates must render a page
that carries them** before anything here can send a valid webmention.

Two options, and the choice belongs to whoever does the blog-side work:

- **A daily page** at `/interactions/2026-08-06/` listing that day's likes and replies, each
  with `class="u-like-of"` / `u-in-reply-to`. One `source` per day, several targets. Legal,
  simple, and slightly odd — a receiver shows "someone liked this" pointing at a page of
  fifty unrelated likes.
- **A page per interaction**, generated from the data file. More URLs, correct semantics,
  a receiver renders it properly.

**Recommendation: per-interaction pages**, generated by Hugo from the same data — the
cost is a template, and it makes every sent webmention point at something that reads
sensibly to a human who follows it. Decide this while doing sprint 1's templates and record
it there; this sprint just needs `sourceUrl` to exist per entry.

A consequence worth stating: **the source page must be live before the webmention is sent.**
Publishing commits, then Actions builds, then the page exists. Sending immediately after the
commit means sending a `source` that 404s, and a conscientious receiver will reject it. So
delivery waits for the build — which is exactly what Hugo sprint 4's `HugoDeployWatch`
already does. Reuse it: send after the watch reports `live`, and mark entries
`awaiting-build` until then.

## State model

```ts
export type DeliveryState =
  | 'pending'         // published, waiting for the site build
  | 'no-endpoint'     // checked; target does not accept webmentions. Normal.
  | 'delivered'       // endpoint returned 2xx
  | 'failed'          // reachable but refused, or the proxy could not help
  | 'unsupported';    // no proxy able to POST is configured
```

Retry policy: **one attempt per entry, plus a manual "retry" on `/posse`.** No automatic
backoff loop. A webmention is a courtesy notification; a client that retries them on a
schedule is a client that spams strangers' endpoints.

## Non-goals

- **No Vouch, no Salmentions, no private webmentions.** Extensions that matter at a scale
  this is nowhere near.
- **No receiving.** Still impossible, still webmention.io's job (sprint 1).
- **No sending on someone else's behalf**, and no bulk-sending historical interactions.
  Only what the user queued and published, going forward.
- **No endpoint caching across sessions.** A per-batch in-memory cache is fine — several
  entries often target the same host — but persisting "this site has no endpoint" would
  quietly outlive the day someone adds one.

## Test notes

- Discovery is a pure parser over a fetched document: `Link:` header wins over `<link>`,
  `<link>` wins over `<a>`, relative resolution, empty `href` meaning self, and a document
  with none of them. All table-testable with fixture HTML.
- Delivery: correct form encoding; 202 counts as accepted; 400 is `failed` with the
  response body as the reason; a proxy that cannot POST yields `unsupported`, not `failed`.
- The Mastodon case end-to-end: queue a like on a mastodon.social URL, publish, and assert
  it lands in `no-endpoint` with no error styling anywhere.
- Same two spec traps as before (`vitest-fetch-spec-traps`).

## The real test

Send a webmention from Mawkingbird to `mistersql`, and watch sprint 1's cron pick it up.
That is the only end-to-end proof this feature has, and it needs both ends built — which is
why receiving was sprint 1 and this is sprint 3.

## Handoff note

Discovery and delivery are separable: shipping discovery alone gives `/posse` an accurate
"this target accepts webmentions" indicator, which is informative on its own and is most of
the risk. Delivery is then a POST and a state transition.
