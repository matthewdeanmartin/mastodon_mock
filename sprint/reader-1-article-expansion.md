# Reader 1 — Article expansion (readability)

Status: **plan only, no code written**
Owner: matthewdeanmartin
Written: 2026-08-20

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
| Where does extraction run? | **Pure client-side.** Reuse the existing `feeds` route to get the bytes; Readability-style extraction and HTML→markdown happen in the browser. No Worker change in v1. |
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
3. Shipping without a Worker deploy means the whole feature can be turned off
   with a feature flag and iterated on daily. Given the honest expectation that
   **a large fraction of pages will fail**, the ability to iterate fast on the
   extractor is worth more than the elegance of doing it once server-side.

Server-side markdown conversion for paid users stays a live option and is
explicitly *not* foreclosed: the client boundary below (`ArticleSource`) is
shaped so a Worker that returns `{markdown, title, byline}` can be dropped in
as a second implementation without touching the reader.

### Why not a dedicated `article` proxy route (yet)

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

The proxy currently sets no `redirect` option, so a `301` comes back to the
caller as a `301`. That has to change, and it is the one Worker change this
sprint needs.

**Why refusing redirects is not viable.** Shorteners are ubiquitous — `bit.ly`,
`t.co`, `lnkd.in`, `buff.ly` — and are exactly how a long blog post reaches a
reader in the first place. Beyond shorteners, ordinary URLs redirect constantly:
`http`→`https`, apex→`www`, trailing-slash normalization, CMS permalink
migrations. A reader feature that fails on all of those fails on most real
input.

**The fix is `redirect: 'manual'` in a loop**, revalidating each hop:

```js
let url = target, hops = 0;
while (hops++ < MAX_HOPS) {
  const res = await fetch(url, { redirect: 'manual', headers: safeHeaders });
  if (!isRedirect(res.status)) return { res, finalUrl: url };
  const next = new URL(res.headers.get('location'), url);  // may be relative
  assertDestinationAllowed(next, route);   // the same check hop zero got
  url = next;
}
```

This is strictly better than both alternatives. `redirect: 'follow'` hides the
intermediate hops so the destination rules only ever see hop zero; refusing
redirects outright breaks the common case. `manual` gives us every hop and
re-runs the existing validation on each.

Details that matter:

- **`MAX_HOPS` of 3–5.** A redirect loop is otherwise a free way to burn the
  Worker's subrequest budget.
- **Relative `Location`.** `new URL(location, url)` — a bare `/new-path` is
  legal and common.
- **The content-type gate stays on the final response only.** A 302's
  `Content-Type` describes the little "moved here" body, not the destination,
  so there is nothing useful to check mid-chain. The gate already runs before
  any body is read, which is where it should be: a chain ending at a 2 MB mp3
  is rejected for the cost of headers.
- **`finalUrl` must reach the client.** Non-negotiable for this feature:
  relative links and `<img src>` in the extracted article resolve against the
  URL the content actually came from. Getting this wrong breaks every image on
  every redirected blog. Return it in a response header and add it to the
  route's `exposeResponseHeaders`, the way `webmention-discover` already
  exposes `Link`.
- **Cache key.** The `feeds` route caches 5 minutes keyed on the request URL,
  i.e. on hop zero. A shortener whose target changes within the window serves
  the old target. Accepted deliberately — the window is short and the
  alternative is not caching shortened URLs at all.

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
   ├─ ArticleQuota        ── free: 2/day localStorage counter; Plus: bypass
   ├─ ArticleCache        ── IndexedDB store, TTL, keyed by normalized URL
   └─ ArticleFetch
        ├─ CorsProxy.proxyRequest(route='feeds', url)   [existing, unchanged]
        └─ ArticleExtract  ── DOMParser → candidate scoring → sanitize
             └─ HtmlToMarkdown ── sanitized DOM → markdown string
   │
   ▼
ExtractedArticle { url, title, byline, siteName, markdown, wordCount,
                   images[], quality, diagnosis, fetchedAt }
   │
   ▼
reader renders it in the existing <article class="reader"> chrome
```

### New files (proposed)

All under `ui/src/app/providers/article/`, mirroring how `providers/rss/`
is laid out (fetch / parser / adapter / cache, each with a spec):

| File | Responsibility |
|---|---|
| `article-fetch.ts` | Orchestrates cache → quota → proxy → extract. The only thing the UI talks to for "get me this article". |
| `article-extract.ts` | Pure function: `(html: string, baseUrl: string) => ExtractedArticle`. No Angular, no HTTP, no DOM globals beyond `DOMParser`. |
| `article-scoring.ts` | The Readability-style candidate scoring, split out because it is the part that will be tuned repeatedly. |
| `article-diagnosis.ts` | Pure function: `(html, extracted) => ArticleDiagnosis`. Paywall/botwall/JS-only/too-short detection. |
| `html-to-markdown.ts` | Sanitized DOM → markdown. |
| `article-cache.ts` | IndexedDB store + TTL, modeled on `rss-cache.ts`. |
| `article-quota.ts` | The 2/day counter and the Plus bypass. |
| `article-models.ts` | `ExtractedArticle`, `ArticleDiagnosis`, `ArticleQuality`, the failure enum. |

Plus a `article-panel/` component under `pages/thread/` if the reader markup
grows enough to want its own file — decide during implementation, not now.

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
5. **Resolve URLs** — every `href` and `src` made absolute against the fetched
   URL, so a relative link in the extracted body still works from our origin.
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

## Failure taxonomy and UX

```ts
type ArticleDiagnosis =
  | 'ok'
  | 'partial'          // extracted, but short or high link-density
  | 'paywall'          // paywall markers, or truncation markers
  | 'bot-check'        // challenge markers, or 403
  | 'needs-js'         // near-empty body + framework root node
  | 'redirected'       // proxy returned 3xx (it does not follow)
  | 'not-html'         // proxy refused the content type
  | 'too-large'        // over the route cap
  | 'rate-limited'     // 429 from the proxy
  | 'network'          // everything else
```

Rendering rules:

- `ok` → article body, no banner beyond a small "Expanded from `<host>`" line
  and the fallback link.
- `partial` → body **plus** a banner: "This looks like only part of the
  article." + fallback link.
- `paywall` / `bot-check` / `needs-js` → whatever text was recovered (often the
  lede, which is genuinely useful) + a banner naming the specific cause +
  fallback link, styled as information rather than error.
- everything else → no body, banner with the cause, fallback link.

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
  a news site with a paywall, a Cloudflare challenge page, a JS-only SPA shell,
  a page with three `<article>` elements, a page with none. Each asserts
  extracted title + expected diagnosis + a word-count range. This corpus **is**
  the spec for the extractor, and the honest measurement record — pass rates go
  in this file the way the proxy catalog records its per-service measurements.
- Unit specs per module, matching the repo's one-spec-per-file convention.
- Security specs: `<script>` in extracted body never survives sanitize; a
  `javascript:` href is dropped; relative URLs resolve; a data-URI image is
  handled per the existing feed rules.
- Quota specs: cache hit does not consume; failure does not consume; day
  rollover resets; Plus bypasses.
- `make check` in `ui/` must pass. Note the memory record that this repo has
  **pre-existing `make check` failures** — establish the baseline before
  starting so new failures are distinguishable from inherited ones.

## Sprint breakdown

**Reader 1a — extraction core (no UI).**
`article-models.ts`, `article-extract.ts`, `article-scoring.ts`,
`html-to-markdown.ts`, `article-diagnosis.ts`, the fixture corpus, specs.
Deliverable: a pure function and a measured pass rate. Nothing user-visible.
This is the sprint that decides whether the feature is viable at all — if the
pass rate on plain blogs is poor, stop here and reconsider the dependency.

**Reader 1b — transport, cache, quota.**
`article-fetch.ts`, `article-cache.ts`, `article-quota.ts`, storage-registry
entries, feature flag. Deliverable: `expand(url)` works from a console.

**Reader 1c — reader UI.**
The button, the states, the banners, the collapse/re-fetch, images pref,
a11y (the expanded region is a landmark, focus moves to it, it is announced).

**Reader 1d — polish and honesty pass.**
Copy review on every diagnosis message, the Plus upsell wording, the
"Expanded from `<host>`" attribution line, and a docs page recording the
measured pass rate per site type.

## Explicitly out of scope

- Executing JavaScript, headless browsing, or anything that renders the page.
- Bypassing paywalls, bot checks, or consent walls. If a publisher says no, the
  answer is the fallback link. This is a product boundary, not just a technical
  one.
- Multi-page article stitching ("read next page").
- Server-side extraction.
- A dedicated `article` proxy route.
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
