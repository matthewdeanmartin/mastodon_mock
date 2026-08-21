# Reader 1 — Article expansion (readability)

Status: **1a–1f implemented** (2026-08-21). Remaining: a fixture corpus built
from real saved pages, and the measured pass-rate table that depends on it.
Owner: matthewdeanmartin
Written: 2026-08-20

## Sprint 1f outcome (2026-08-21) — diagnostics, and a route of our own

Triggered by a real failure: fetching a News Tribune article returned a raw
Cloudflare `520` JSON blob, and the reader was told "Couldn't reach this page"
— which was **false**. The page had been reached, and had deliberately refused.
Finding that out required devtools.

Three separate defects behind one symptom:

1. **The 520 was the *upstream's* status, relayed verbatim.** The proxy passed
   status and body straight through with nothing saying where it came from. The
   proxy and the target draw from the same status space, so a relayed `520` and
   a proxy-authored `502` are indistinguishable to a caller.
2. **The failure was cached for five minutes.** `Cache-Control: max-age=300`
   was set from `cacheable` alone, without checking the status — so the browser
   refused to retry past a transient refusal. (The edge-cache *write* was
   correctly gated on 200; only the downstream header was wrong.)
3. **The client mapped every 5xx to `network`**, producing the untrue sentence.

### The design question this raised

Fixing (1) with headers exposed the underlying tension, which the operator
named directly: *"when we are acting like a CORS proxy, we're hard core a CORS
proxy"* — the relay contract means the body is never ours to shape, so error
detail had to be smuggled through headers while the body stayed whatever the
refusing party sent.

The resolution: a dedicated **`article` route** with `bufferErrors: true`.
Success stays a byte-for-byte relay — the article HTML is the article HTML, and
nothing about a hostile source changes that. **Failure** stops being a relay,
because a refused article has no bytes worth preserving verbatim, only *facts
about* the refusal. The Worker writes those facts as one JSON document and
quotes the upstream's own words inside it.

`feeds` deliberately keeps working for article fetching, for known-friendly
sources (Wikipedia and the like) where a plain relay is all that is wanted. The
client asks for `article` and falls back to `feeds` on `No such route`, so the
app can ship ahead of the Worker without breaking.

### What this does not fix

Paywalls, bot blocks and consent walls are still refusals by the publisher. No
transport change makes thenewstribune.com serve that article. What changed is
that the reader is now told *precisely what happened*, in the page, without
devtools — including the site's own error text and which host refused.

## Sprint 1e outcome (2026-08-21)

Copy, a11y, attribution, and the `Status.card` win. Two things found while
doing it that were not polish:

- **The fallback ladder had a hole.** A failure where metadata *also* failed
  rendered a diagnosis message and nothing else — no card, no link, no retry.
  That is precisely the dead end this document said it would never ship, and it
  survived 1d because the tests covered "card present" and "article present"
  but not "neither". The ladder now terminates in a labelled link.
- **Three buttons silently did nothing at zero quota.** "Try again" and
  "Re-fetch" both call `expandArticle`, whose quota guard returns early, so at
  zero remaining they were live buttons that did nothing when pressed. Now
  disabled, matching the guard. A silent no-op reads as a bug in the app rather
  than as a limit being enforced.

`Status.card` now renders through the shared `preview-card/` component, but
only when a post has no media of its own — a card image and an author's upload
side by side are two pictures competing for one glance, and the upload wins.
The mock server already serializes `card` (`serializers/statuses.py`), so this
renders against real data rather than being speculative.

## Calibration record (2026-08-21)

Two thresholds were wrong on first contact with the test corpus, both in the
*false junk* direction the plan warned about — rejecting real articles:

| Threshold | Was | Now | Why |
|---|---|---|---|
| `THIN_WORDS` (`article-quality.ts`) | 400 | 200 | A 300-word post is an ordinary complete blog entry. Flagging it "may be only part of the article" would put a false caveat on a large share of the personal blogs this feature exists to read. |
| Tier 1 empty-page floor (`article-diagnosis.ts`) | 200 | 60 | The real bug. It counts the **whole document** while the quality gate counts the **extracted body**, so at 200 it sat *above* `MIN_WORDS` and shadowed the gate entirely: a genuine 180-word post was rejected before the extractor ever ran, reported as `junk` with no metrics to explain why. Any document-level floor must stay well below the gate's body-level floor. |

The second is the more instructive failure. It was not a mis-tuned number but a
category error — two thresholds measuring different things, where one silently
pre-empted the other. Worth remembering when adding any further pre-checks.

## The feature in one sentence

In reader mode, a post that links out to an article gets an **Expand article**
button; the app fetches the remote page through the CORS proxy, extracts the
article body client-side, renders it as markdown inside the existing reader
chrome, and — always, unconditionally — keeps the "Read on the original site"
link visible for when it does not work.

## Why this shape

The reader already exists and is already good. `pages/thread/thread.ts` +
`thread.html` give us font size, font family, paper theme, an author header,
and the fallback link; `reader-chain.ts` decides what a "post storm as article"
is. None of that changes. This sprint adds **one more source of reader body
content**: instead of only the author's own Mastodon/RSS chain, the reader can
also hold the extracted text of a remote page.

The main use case is a long blog reaching a reader who wants Mawkingbird's
kindle-ish reading surface rather than the publisher's newsletter-popup,
cookie-banner, sticky-header version of the same words.

## Decisions taken (answered 2026-08-20)

| Question | Decision |
|---|---|
| Where does extraction run? | **Pure client-side.** Reuse the existing `feeds` route to get the bytes; Readability-style extraction and HTML→markdown happen in the browser. The Worker gains redirect-following but never parses HTML. |
| Paid gate | **Free 2 articles/day** (client-side day counter), Plus effectively unlimited (Worker rate limit only). |
| Hostile-page UX | **Show what we got, plus an honest diagnosis banner** naming the specific failure (paywall / bot check / JS-only / too short), and the fallback link. Below a quality floor, show a **preview card** instead of a bad article. |
| Caching | **Reuse the IndexedDB store** next to `RssCache`, with its own object store and TTL. |
| Redirects | **Followed, with per-hop validation.** Shorteners are too common to refuse. Requires a Worker change — see below. |

### Why client-side, given the server-side option was on the table

Three reasons, and the third is the one that decides it:

1. `mawkingbird_cors_proxy/src/config.ts` states its own posture explicitly —
   the proxy relays bytes and never interprets them. HTML parsing in a Worker
   means a DOM shim on the hot path and a new class of parse-bomb input.
2. The `feeds` route already permits `text/html`, caps at 2 MB, rate-limits at
   60/min and edge-caches for 5 minutes. That is exactly the policy an article
   fetch wants, already deployed, already reviewed.
3. Keeping extraction in the client means the part that will need constant
   tuning ships with the app, behind a feature flag, iterable daily. The Worker
   change this sprint does need (redirect-following) is a one-time ~20-line
   addition to existing machinery, not an ongoing dependency. Given the honest
   expectation that **a large fraction of pages will fail**, the ability to
   iterate fast on the extractor is worth more than the elegance of doing it
   once server-side.

Server-side markdown conversion for paid users stays a live option and is
explicitly *not* foreclosed: the client boundary below (`ArticleSource`) is
shaped so a Worker that returns `{markdown, title, byline}` can be dropped in
as a second implementation without touching the reader.

### Why not a dedicated `article` proxy route (yet) — *superseded*

> **Reversed 2026-08-21, in sprint 1f.** The route now exists.
>
> The original reasoning below was that a dedicated route "buys nothing the
> `feeds` route does not already provide". That held right up until the first
> real failure, and the thing it missed was not the quota or the content-type
> list — both of which really were nice-to-haves — but **error shape**. A
> relay cannot own its failure bodies, and a failed article fetch is exactly
> the case where the body needs to be ours. That is a property of what the
> route is *for*, not of how much traffic it carries, and it was visible in
> principle on day one.

It would be the tidier long-term home for a per-day quota and a tighter
content-type list. It was rejected for v1 only because it costs a Worker deploy
plus a `CorsProxyRoute` wire-contract change in the client, and buys nothing the
`feeds` route does not already provide. Revisit when (a) the free-tier quota
needs real enforcement, or (b) server-side extraction ships. Both are listed
under Future work.

## What we are up against (stated plainly)

This is the part previous attempts at this feature get wrong by being
optimistic. Curling a random blog post returns, in rough order of frequency:

- **Cookie/consent interstitial** — the real article is behind a "Accept all"
  wall and the served HTML is the banner.
- **Bot block** — Cloudflare "Verify you are human", a 403, or a 200 whose body
  is a challenge page. The Worker's `Accept-Encoding: identity` and absent
  `Referer` make us look *more* like a bot, not less.
- **Paywall** — full text present but `display:none`, or truncated with a
  "subscribe to continue" node, or genuinely absent.
- **JS-only page** — an empty `<div id="root">`. Explicitly out of scope; the
  goal is to *detect and say so*, never to execute anything.
- **Non-HTML** — PDF, or a content type outside the `feeds` allowlist. The
  proxy rejects it before reading the body, which is the right behaviour and
  needs its own message.

Redirects are *not* on this list, because they are not a failure — see the
next section.

The design consequence: **failure is the expected path often enough that it
must be a first-class, well-labelled outcome, not an error handler.** Every
failure mode gets a named enum value, a human sentence, and the fallback link.
A silent "couldn't load" is the one thing we will not ship.

## Redirects: followed, with per-hop validation

**Correction (2026-08-21): this was already implemented.** An earlier draft of
this document claimed the Worker refused redirects. It does not — `handler.ts`
resolves them itself in a `redirect: 'manual'` loop with `MAX_REDIRECTS`,
re-running `parseDestination` and `routeAllowsHost` on every hop, resolving
relative `Location` values, and applying browsers' 303/POST method-rewrite
rules. The comment there records the same reasoning this section reached
independently, including that a blanket refusal "was too strict to be usable".

The only real gap is that the client is never told **where the chain ended**,
which this feature needs — see below. Everything else in this section is a
description of code that already exists.

**Why refusing redirects would not be viable.** Shorteners are ubiquitous —
`bit.ly`, `t.co`, `lnkd.in`, `buff.ly` — and are exactly how a long blog post
reaches a reader in the first place. Beyond shorteners, ordinary URLs redirect
constantly: `http`→`https`, apex→`www`, trailing-slash normalization, CMS
permalink migrations. A reader feature that failed on all of those would fail on
most real input.

### The one change needed: `finalUrl`

Relative links and `<img src>` in an extracted article must resolve against the
URL the content **actually came from**, not the one we asked for. Resolving
against the requested URL breaks every image on every redirected blog, which is
a large share of them.

`buildDownstreamHeaders` already has the mechanism — `exposeResponseHeaders`,
which `webmention-discover` uses for `Link`. But the final URL is not an
upstream header; it is a fact the handler knows and nothing records. So:

- Handler sets `X-Proxy-Final-Url` on the downstream response when the chain
  moved (i.e. `hops > 0`).
- The header is added to the `feeds` route's `exposeResponseHeaders` so the
  browser will actually let the page read it. **Without this the client cannot
  see the header at all**, regardless of the Worker setting it — that is the
  CORS rule this field exists for.
- Absent header means "no redirect happened", so the client falls back to the
  requested URL. Backward compatible: existing callers ignore it.

### Notes on what is already there

- **`MAX_REDIRECTS`** is set to 3, with a comment explaining the choice.
- **The content-type gate runs on the final response only**, which is correct.
  A 302's `Content-Type` describes its little "moved here" body, not the
  destination, so there is nothing useful to check mid-chain. A chain ending at
  a 2 MB mp3 is rejected for the cost of headers.
- **Cache key.** The `feeds` route caches 5 minutes keyed on the request URL,
  i.e. on hop zero. A shortener whose target changes within the window serves
  the old target. Accepted — the window is short and the alternative is not
  caching shortened URLs at all.

### On SSRF, briefly

The textbook argument against following redirects is that a public URL can
bounce the fetcher to `169.254.169.254` and return cloud instance credentials.
That does not apply here: Workers have no instance metadata service to reach.
Revalidating scheme, port and host per hop is kept because it is nearly free and
keeps the proxy honestly described as narrow, not because a specific attack is
being modelled. Whether Cloudflare's egress would route to private space is
Cloudflare's concern, not this app's.

### Why a malicious target page is not the risk it looks like

Worth stating once, because "we fetch a URL a stranger controls and render it"
sounds alarming and is not:

```
bytes → DOMParser (detached document — nothing executes, no network)
      → extract + sanitize
      → markdown string
      → block renderer, allowlisted tags only
      → DOM
```

`DOMParser` does not run scripts, does not fire `<img>`, and does not touch the
network. The markdown round-trip is the real choke point: **markdown has no way
to express a script, an event handler, or an attribute we did not choose to
emit.** Whatever the hostile page contains, what survives is headings,
paragraphs, emphasis, links, images and code — because that is the renderer's
entire vocabulary.

Compare against the honest baseline: the fallback link, which we ship anyway
and which sends the user to the page where its JavaScript *does* run. Expansion
is a downgrade of the attacker's capability, not an upgrade.

Two things do need care, and both are inside our renderer rather than the
transport:

- **`href` schemes.** Markdown links can carry `javascript:` or `data:`.
  Allowlist `http`/`https` at render time.
- **The `[innerHTML]` boundary.** The reader renders through `[innerHTML]`, so
  the renderer's output allowlist *is* the boundary — the same one
  `sanitizeFeedHtml` already enforces for feed content.

Neither is architecture. Both are "do not write the bug," and both get a spec.

## Architecture

```
thread.html  "Expand article" button (reader mode only, when a target URL exists)
   │
   ▼
ArticleExpansion (component-facing facade, signals)
   ├─ ArticleDiagnosis    ── Tier 0: URL shape + known-hostile host  (no fetch)
   ├─ ArticleQuota        ── free: 2/day localStorage counter; Plus: bypass
   ├─ ArticleCache        ── IndexedDB store, TTL, keyed by normalized URL
   └─ ArticleFetch
        ├─ CorsProxy.proxyRequest(route='feeds', url) → { html, finalUrl }
        ├─ ArticleDiagnosis  ── Tier 1: raw-HTML markers (bot/consent/paywall)
        ├─ ArticleMetadata   ── OG / Twitter / JSON-LD → PreviewCard  [always]
        └─ ArticleExtract    ── DOMParser → scoring → sanitize
             ├─ HtmlToMarkdown  ── sanitized DOM → markdown string
             └─ ArticleQuality  ── Tier 2 metrics → good | thin | junk
   │
   ▼
ArticleResult {
  card: PreviewCard,          // always present when metadata survived
  article?: {                 // absent when quality === 'junk'
    title, byline, siteName, markdown, wordCount, images[], quality
  },
  finalUrl, diagnosis, fetchedAt
}
   │
   ▼
good | thin → reader renders it in the existing <article class="reader"> chrome
junk | fail → <app-preview-card> + diagnosis banner + fallback link
```

### New files (proposed)

All under `ui/src/app/providers/article/`, mirroring how `providers/rss/`
is laid out (fetch / parser / adapter / cache, each with a spec):

| File | Responsibility |
|---|---|
| `article-fetch.ts` | Orchestrates cache → quota → proxy → extract. The only thing the UI talks to for "get me this article". |
| `article-extract.ts` | Pure function: `(html: string, finalUrl: string) => ExtractedArticle`. No Angular, no HTTP, no DOM globals beyond `DOMParser`. |
| `article-scoring.ts` | The Readability-style candidate scoring, split out because it is the part that will be tuned repeatedly. |
| `article-metadata.ts` | OpenGraph / Twitter-card / JSON-LD → `PreviewCard`. Runs unconditionally on every fetch, independent of body extraction. |
| `article-quality.ts` | The Tier 2 metrics and the `good`/`thin`/`junk` verdict. |
| `article-diagnosis.ts` | Tier 0 and Tier 1 checks: known-hostile hosts, URL shape, challenge/consent/paywall markers. |
| `html-to-markdown.ts` | Sanitized DOM → markdown. |
| `article-cache.ts` | IndexedDB store + TTL, modeled on `rss-cache.ts`. Also holds the per-host success record Tier 0 reads. |
| `article-quota.ts` | The 2/day counter and the Plus bypass. |
| `article-models.ts` | `ExtractedArticle`, `ArticleDiagnosis`, `ArticleQuality`, the metrics interface. |

Plus a shared `preview-card/` component under `src/app/` (not under
`pages/thread/`) — it renders the existing `PreviewCard` model, and its second
consumer is Mastodon statuses whose `card` field the app currently ignores.

### Why no npm dependency

`ui/package.json` has **zero** third-party runtime dependencies outside
Angular, rxjs, tslib and emoji-mart. Adding `@mozilla/readability` + `turndown`
would be the first real break in that, and both would need auditing as
dependencies that parse hostile input.

Against that: Readability is ~2k lines of heuristics refined over a decade, and
a hand-rolled version will be worse. The recommendation is:

- **Write our own extractor first**, deliberately small (see below). The bar is
  not "as good as Firefox Reader View" — it is "better than a link" on the
  blogs this app's users actually read, which skew toward simple,
  semantically-marked-up personal sites.
- Measure it against a fixture corpus (below). If it lands under ~70% on plain
  blogs, revisit `@mozilla/readability` as a scoped, reviewed dependency with a
  written rationale, the way the CORS proxy catalog records its measurements.

The same logic applies to `turndown`: our markdown target is small (headings,
paragraphs, emphasis, links, lists, blockquotes, code, images, hr) because that
is all the reader renders anyway.

### The extractor, concretely

Deliberately small, in this order:

1. **Parse** with `DOMParser` into a detached document. Never inserted into the
   live DOM, so no `<script>` runs, no `<img>` fires, no network happens.
2. **Strip** the always-junk: `script`, `style`, `noscript`, `iframe`, `svg`,
   `form`, `nav`, `aside`, `footer`, `header`, and anything matching a
   junk-class regex (`share`, `related`, `newsletter`, `comment`, `promo`,
   `cookie`, `sidebar`, `advert`).
3. **Prefer semantics.** If exactly one `<article>` exists, or a
   `[itemprop=articleBody]`, or `main article`, take it and skip scoring. Most
   personal blogs and every static-site generator land here, which is the
   population we care about most.
4. **Score** otherwise: per-block-element score from text length, comma count,
   paragraph count, penalized by link density and junk classes, with parent
   score inheritance. Take the top scorer plus its siblings above a threshold.
5. **Resolve URLs** — every `href` and `src` made absolute against **`finalUrl`**
   (the end of the redirect chain), not the URL we asked for. Resolving against
   the requested URL breaks every relative link and image on any redirected
   blog, which is most of them.
6. **Sanitize** through the *existing* `sanitizeFeedHtml` in
   `providers/rss/rss-adapter.ts` if its tag allowlist is close enough, or a
   sibling function sharing its allowlist constants. This is the security
   boundary and it must not be reimplemented: feed HTML and article HTML are
   the same threat model (arbitrary remote markup rendered via `[innerHTML]`).
7. **Convert** the sanitized DOM to markdown.

Metadata (title, byline, site name, lead image) comes from OpenGraph /
`<meta name="author">` / JSON-LD `Article` when present, falling back to
`<title>` and `<h1>`.

### Why markdown at all, rather than rendering sanitized HTML

Worth stating because the shortest path is to skip it:

- Markdown is a **normalization step that discards layout**, which is precisely
  the feature. The publisher's floats, columns, and inline styles cannot
  survive a markdown round-trip, so the reader's own typography always wins.
- It is small enough to cache comfortably in IndexedDB and cheap to re-render.
- It is what a future "save this article to my PKM / write workspace" would
  want, and `providers/` already has PKM notes and a publish wizard next door.
- The rendered-markdown path is the same one the reader already trusts.

The reader renders markdown → HTML through a renderer that emits only the
allowlisted tag set. Note that `src/app/markdown.ts` is **not** that renderer —
it is a deliberately minimal inline-only transform for status text that bails
out on links, images and fenced code. Article markdown needs a real (still
small) block renderer; do not extend `markdown.ts` to cover both, because its
"weird constructs turn markdown off" rule is correct for statuses and wrong
for articles.

## Quota and the paid gate

```
ArticleQuota
  isPlus()            → PlusSession has a live token
  remainingToday()    → 2 - count, or Infinity for Plus
  consume()           → increments; refuses at 0
```

- Stored in `localStorage` under a new key, registered in
  `storage-registry.ts` as **`cache`** sensitivity (a refetchable counter, never
  exported) — the registry gate is enforced in this repo and a new key without
  a registry entry will fail its spec.
- Day boundary is local midnight, stored as a date string, so a stale counter
  from another day resets on read rather than needing a timer.
- **A cache hit does not consume quota.** Re-reading an article you already
  expanded must be free, or the feature feels punitive.
- **A failed extraction does not consume quota.** Spending one of two daily
  articles on a Cloudflare challenge page is the fastest way to make a paid
  feature feel like a scam.
- Honest framing in the UI: "1 of 2 free articles today — Mawkingbird Plus
  removes the limit." Trivially bypassable by clearing storage, and that is
  fine and consistent with the app's anonymous-by-design posture; the counter
  is a nudge, not an enforcement boundary. Real enforcement, if it is ever
  wanted, belongs on a dedicated Worker route.
- Gate the whole feature behind a new feature flag (`reader-article`, following
  the existing `feature-flags.ts` id convention) so it can be dark-shipped.

## Catching the degenerate case

The single most important quality decision in this feature: **knowing when not
to render an article.** A confidently-rendered page of navigation links, cookie
copy and "Subscribe to continue" is worse than no feature at all, because it
teaches the user the button lies. The system needs a floor below which it stops
trying and hands back a link or a card instead.

There are three places to catch it, cheapest first.

### Tier 0 — before fetching (free, no quota spent)

Decide from the URL alone that expansion is pointless. Costs nothing, spends no
quota, and can hide the button entirely rather than offering a failure.

- **Known-hostile hosts.** A small, honestly-labelled list of sites that reliably
  refuse: major news paywalls, `x.com`/`twitter.com`, `medium.com` behind its
  meter, LinkedIn, Facebook. Recorded as *measured*, the way
  `cors-proxy-catalog.ts` records which proxies were tested and failed — with
  the date and the observed behaviour, not folklore.
- **Non-article URL shapes.** A bare host with no path (`https://example.com/`)
  is usually a homepage, not an article. File extensions we cannot read:
  `.pdf`, `.zip`, `.mp3`, `.mp4`, `.jpg`.
- **Known-good hosts** get the inverse treatment: a site previously extracted
  successfully (recorded per-host in the cache) can show a more confident
  button.

Tier 0 is a *hint*, never a hard block — the button becomes "Try to expand"
rather than disappearing, because a wrong entry in a static list should cost
the user a click, not the feature.

### Tier 1 — on the raw HTML, before extraction

Cheap string and DOM checks on the fetched bytes.

- **Body text length.** Under ~200 words of total text in the whole document:
  nothing to extract regardless of how good the extractor is.
- **Framework shell.** `<div id="root">` / `<div id="__next">` / `<div id="app">`
  as effectively the only body content, plus near-zero text → `needs-js`.
- **Challenge markers.** "Verify you are human", "Checking your browser",
  `cf-browser-verification`, "Enable JavaScript and cookies to continue",
  Turnstile/hCaptcha/reCAPTCHA script hosts → `bot-check`.
- **Consent-wall markers.** The whole document is a consent dialog: body text
  dominated by "we and our partners use cookies", "legitimate interest",
  vendor-list boilerplate → `consent-wall`.
- **Paywall markers.** `paywall`, `piano-`, `tp-modal`, `subscriber-only`,
  `<meta name="article:content_tier" content="locked">`, JSON-LD
  `isAccessibleForFree: false` → `paywall`. That last one is the good signal —
  it is a machine-readable declaration by the publisher.

### Tier 2 — on the extracted result (the real quality gate)

The one that catches everything the first two miss. Compute a small set of
metrics on the extraction and gate on them:

| Metric | Meaning | Reject when |
|---|---|---|
| `wordCount` | words in extracted body | `< 150` |
| `linkDensity` | linked words ÷ total words | `> 0.35` |
| `textToMarkupRatio` | text chars ÷ HTML chars of the chosen subtree | very low |
| `paragraphCount` | `<p>` with ≥ 25 words | `< 2` |
| `topCandidateScore` | winning score from `article-scoring.ts` | below floor |
| `titleInBody` | does the `<h1>`/OG title appear in the extraction | absent is a warning |
| `boilerplateRatio` | share of text matching nav/footer/legal phrases | high |

These collapse into one `ArticleQuality`:

```ts
type ArticleQuality = 'good' | 'thin' | 'junk';
```

- **`good`** — render the article.
- **`thin`** — render it, with the "this may be only part of the article"
  banner. Genuinely useful: a lede plus two paragraphs beats a link.
- **`junk`** — do not render an article at all. Fall through to the card.

`linkDensity` is the highest-value single metric — it is what distinguishes a
nav-and-footer soup from prose, and it is what catches the homepage-instead-of-
article case that Tier 0 missed.

**Calibrating this is what the fixture corpus is for.** The thresholds above are
starting guesses; the corpus turns them into measured values, and the measured
pass/reject rates get written back into this document.

### The fallback ladder

Never a dead end. In order of preference, take the best available:

1. **Full article** (`good`).
2. **Partial article + banner** (`thin`).
3. **Preview card** — title, description, lead image, site name, host. Built
   from OpenGraph/Twitter-card/JSON-LD metadata, which is present on a large
   share of pages *including* ones that refuse extraction. A paywalled news
   article almost always has a perfectly good `og:title`, `og:description` and
   `og:image` — the publisher wants it to look good when shared. So the
   degenerate case usually still produces something worth looking at.
4. **The RSS item's own summary**, when we came from a feed. Often the
   publisher's own excerpt, and better than nothing.
5. **A plain labelled hyperlink**, with the diagnosis.

### The card is a real payoff, not a consolation prize

Two things make this cheap and worth doing:

- `PreviewCard` **already exists** in `src/app/models.ts` (`url`, `title`,
  `description`, `image`, `provider_name`, …) and `Status.card` already
  references it — but nothing in the app renders it today. So this sprint gets
  to define that rendering, and a `<app-preview-card>` component immediately
  has a second consumer: Mastodon statuses that carry a `card` and currently
  drop it on the floor.
- Metadata extraction is a **fraction of the work** of article extraction and
  succeeds far more often. It should therefore be its own module
  (`article-metadata.ts`), run *unconditionally* on every fetch, and be
  independent of whether body extraction succeeds. Card-on-failure then costs
  nothing extra.

Worth being explicit about the resulting design: **metadata extraction is the
thing that always works, and article extraction is the bonus on top.** That
inversion is what makes the failure path acceptable — and it means the honest
version of the feature is "expand this link", not "read this article".

### Interaction with quota

Restating, because it is what makes the degenerate case tolerable:

- Tier 0 rejections spend **no** quota and involve no fetch.
- A fetch that yields `junk` spends **no** quota — the user got a card, not an
  article, and charging for that is how a paid feature earns a refund request.
- Only a `good` or `thin` render consumes one of the two free daily articles.
- Cache hits never consume quota.

## Failure taxonomy and UX

```ts
type ArticleDiagnosis =
  | 'ok'
  | 'partial'          // extracted, but short or high link-density
  | 'paywall'          // paywall markers, or isAccessibleForFree: false
  | 'bot-check'        // challenge markers, or 403
  | 'consent-wall'     // document is a cookie/consent dialog
  | 'needs-js'         // near-empty body + framework root node
  | 'junk'             // extracted something, quality gate rejected it
  | 'not-html'         // proxy refused the content type
  | 'too-large'        // over the route cap
  | 'rate-limited'     // 429 from the proxy
  | 'redirect-loop'    // exceeded MAX_HOPS
  | 'network';         // everything else
```

Note `redirected` is **gone** — a followed redirect is a success with a
`finalUrl`, not an outcome. `redirect-loop` replaces it for the pathological
case only.

Rendering rules:

- `ok` → article body, a small "Expanded from `<host>`" line, and the fallback
  link.
- `partial` → body **plus** a banner: "This looks like only part of the
  article." + fallback link.
- `paywall` / `bot-check` / `consent-wall` / `needs-js` / `junk` → **the
  preview card**, a banner naming the specific cause, and the fallback link.
  Styled as information, not error — the user asked for something reasonable
  and got the best available answer.
- everything else → card if metadata survived, else a labelled link, with the
  cause.

This matches how `feed-doctor.ts` and the connector doctor pages already report
failures in this codebase: name the actual cause, do not generalize to
"something went wrong".

## Caching

New object store in the existing `mockingbird_rss` IndexedDB database (bump
`DB_VERSION`), or a sibling database — prefer the sibling, `mockingbird_articles`,
because bumping a shared DB version couples article work to feed-cache
migrations for no benefit.

- Key: normalized article URL (lowercase host, strip fragment, strip known
  tracking params: `utm_*`, `fbclid`, `gclid`, `ref`).
- Value: the full `ExtractedArticle` including `diagnosis` and `fetchedAt`.
- TTL: 7 days for `ok`; **do not cache** failures beyond a short cooldown (say
  1 hour) so a transient bot-check does not stick for a week.
- Size: cap total stored articles (LRU, ~200) — markdown is small but unbounded
  growth in a shared origin quota is how `QuotaExceededError` takes out
  unrelated writes, which `rss-cache.ts` already documents as a real hazard.
- Registered in `storage-registry.ts` as `cache`.

## UI surface

In `thread.html`, inside the existing reader bar / reader article:

- **Button**: "Expand article" — shown only when `readerMode()` and a target URL
  exists. Target URL selection: for an `rss:` post, the item's own `url`; for a
  Mastodon/Bluesky post, the single outbound link if the post has exactly one
  (never guess between several).
- **States**: idle → loading (skeleton, not a spinner over the text) → expanded
  (with "Collapse" + "Re-fetch") → diagnosed (banner + fallback).
- **The fallback link never disappears.** `readerOriginalLink()` already
  produces it, including the Nitter special case for tweets; the expanded view
  reuses that method unchanged.
- Existing font-size / font-family / paper-theme controls apply to expanded
  content automatically because it renders inside `<article class="reader">`.
- Images: respect the existing images-on/off pref, the same way
  `rss-adapter.ts` pulls images out into attachments so the pref can apply.

## Test plan

- **Fixture corpus.** ~20 saved HTML files under `ui/src/app/providers/article/
  fixtures/`, covering: a Hugo blog, a Jekyll blog, WordPress, Substack, Ghost,
  a news site with a paywall, a Cloudflare challenge page, a cookie-consent
  wall, a JS-only SPA shell, a site homepage (the classic `junk` case), a page
  with three `<article>` elements, a page with none. Each asserts extracted
  title + expected `ArticleQuality` + expected diagnosis + a word-count range.

  This corpus **is** the spec for the extractor and the calibration set for the
  Tier 2 thresholds. It is also the honest measurement record — the resulting
  rates go back into this file the way `cors-proxy-catalog.ts` records its
  per-service measurements, negative results included.
- **Both error directions get counted**, and they are not symmetric:
  *false junk* (a good article rejected) costs the user a feature that would
  have worked; *false good* (junk rendered as an article) costs the user trust
  in the button. Tune toward the first. Track both rates explicitly.
- Metadata specs: a page with OG tags, with Twitter-card tags only, with JSON-LD
  only, with none — the card must degrade cleanly to host + title + link.
- Unit specs per module, matching the repo's one-spec-per-file convention.
- Security specs: `<script>` in extracted body never survives sanitize; a
  `javascript:` and a `data:` href are dropped at render; relative URLs resolve
  against `finalUrl`, not the requested URL; a data-URI image is handled per the
  existing feed rules.
- Worker specs: a 2-hop chain succeeds and reports `finalUrl`; a relative
  `Location` resolves; exceeding `MAX_HOPS` yields `redirect-loop`; a redirect
  to a disallowed scheme or port is refused at that hop.
- Quota specs: cache hit does not consume; `junk` does not consume; failure does
  not consume; day rollover resets; Plus bypasses.
- `make check` in `ui/` must pass. Note the memory record that this repo has
  **pre-existing `make check` failures** — establish the baseline before
  starting so new failures are distinguishable from inherited ones.

## Sprint breakdown

**Reader 1a — Worker: follow redirects.**
`redirect: 'manual'` loop with `MAX_HOPS`, per-hop `assertDestinationAllowed`,
relative-`Location` resolution, `finalUrl` response header added to the `feeds`
route's `exposeResponseHeaders`. Specs in `test/handler.spec.ts`. Deploys
independently and breaks nothing — the client ignores the new header until 1c.
First because everything downstream needs `finalUrl`.

**Reader 1b — extraction core (no UI).**
`article-models.ts`, `article-metadata.ts`, `article-extract.ts`,
`article-scoring.ts`, `article-quality.ts`, `article-diagnosis.ts`,
`html-to-markdown.ts`, the fixture corpus, specs. Deliverable: pure functions
and a **measured** table of pass / thin / junk rates per site type.

This is the go/no-go. Build `article-metadata.ts` **first** — it is small, it
succeeds on most pages, and it is what makes every failure path acceptable. If
body extraction then lands poorly on plain blogs, stop and reconsider
`@mozilla/readability` before any UI exists.

**Reader 1c — transport, cache, quota.**
`article-fetch.ts`, `article-cache.ts`, `article-quota.ts`, storage-registry
entries, feature flag, reading `finalUrl` from the Worker. Deliverable:
`expand(url)` works from a console and returns article-or-card.

**Reader 1d — UI.**
The shared `preview-card/` component, the expand button and its states, the
diagnosis banners, collapse/re-fetch, images pref, a11y (the expanded region is
a landmark, focus moves to it, the state change is announced).

**Reader 1e — polish and honesty pass.**
Copy review on every diagnosis message, the Plus upsell wording, the "Expanded
from `<host>`" attribution, and writing the measured pass rates back into this
document. Optionally: render `Status.card` for Mastodon statuses, now that a
card component exists.

## Explicitly out of scope

- Executing JavaScript, headless browsing, or anything that renders the page.
- Bypassing paywalls, bot checks, or consent walls. If a publisher says no, the
  answer is the fallback link. This is a product boundary, not just a technical
  one.
- Multi-page article stitching ("read next page").
- Server-side extraction. (Redirect-following in the Worker is *in* scope — but
  it relays bytes, it does not parse them.)
- ~~A dedicated `article` proxy route.~~ **Built 2026-08-21** — see the sprint
  1f note above. The relay contract turned out to be the wrong fit for a
  *failed* article fetch, which is a different observation from the one that
  originally deferred this.
- Archive.org / archive.today fallbacks. Tempting and cheap; deferred because
  it changes who the user's request goes to, and this app's whole posture is
  that such a change is a decision the user makes explicitly (see the per-feed
  proxy opt-in in `rss-fetch.ts`).

## Future work, in likely order

1. Record measured pass rates per site type, the way the proxy catalog records
   per-service measurements. Negative results are the valuable ones.
2. "Send to PKM / write workspace" from an expanded article — the markdown is
   already the right format and the destination already exists.
3. Server-side extraction as a Plus benefit, behind a new `article` Worker
   route returning `{markdown, title, byline}`. The `ArticleSource` boundary
   exists so this is an added implementation, not a rewrite.
4. Offline "save article" with explicit user pinning.
5. Reconsider `@mozilla/readability` if the fixture corpus says our extractor
   is not good enough — as a reviewed dependency with a written rationale.
