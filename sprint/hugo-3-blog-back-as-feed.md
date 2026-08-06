# Hugo — Sprint 3: Your blog, back in your timeline

Status: COMPLETE (implemented 2026-08-05; 3266 tests, lint, prettier and both builds clean;
11 tests added). Roadmap: `hugo-0-overview.md`. Depends on sprint 1.

## What changed during implementation

- **`useProxy` became per-feed on the profile page, and that is the interesting part.**
  `profile.ts` hardcoded `this.rss.getFeed(feed.url, true)` — proxy on, for every blog —
  because both existing blogs need it. Hugo does not: GitHub Pages sends
  `access-control-allow-origin: *`, so proxying would route the user's own *public*
  writing through a third party for no reason. The flag now travels with each feed. This
  is the sprint's one real change to shared code, and it is three lines.
- **The discovered feed URL is stored, not re-derived.** The plan had `feedUrl` computed
  from `siteUrl + index.xml`. But `probe()` falls back through `feed.xml`, `rss.xml`,
  `atom.xml` and `index.rss` when a theme has moved the feed — and if the winner is not
  the default, every later "is my blog subscribed?" and every profile load would ask about
  a URL that does not exist. `HugoRepo.feedUrl` records which name won; the computed
  signal prefers it and falls back to the default before any probe has run. It rides
  inside the existing `mockingbird_hugo_repo` key, so no new storage-registry row.
- **The `<link rel="alternate">` HTML-scraping fallback was not built.** The plan listed it
  as the last resort. Four conventional filenames already cover the realistic cases, and
  parsing a site's HTML to find a feed is a meaningfully larger surface (encoding, relative
  URLs, `<base>`) for the tail. The failure message points at the Feeds page for a manual
  add instead, which is one paste and always works. Revisit if a real theme defeats the
  four names.
- **Subscribed state is derived, never stored.** `HugoFeed.subscribed()` asks
  `RssSubscriptions.has()`. A second boolean would immediately disagree with reality the
  moment someone removed the feed on the Feeds page — which is a supported thing to do,
  since it is an ordinary feed.
- **Spec note:** `RssSubscriptions.add()` leaves `useProxy` *absent* rather than `false`
  when it is off (deliberately — an older subscription reads as `undefined` and keeps
  fetching directly). Assert through `subs.usesProxy(url)`, not on the raw field.

The cheapest sprint in the roadmap, because nearly all of it already exists. Hugo ships an
RSS feed by default at `<site>/index.xml`; Mawkingbird has had an RSS provider since
`roadmap-providers.md` phase 1. This sprint is mostly *connecting two things that are
already built* and being careful about the ways that can go wrong.

## Exit criteria

1. From the Hugo connector page, one action subscribes the site's feed — no URL typing.
2. The user's Hugo posts appear in Home like any other RSS feed, with the existing `📡`
   provider badge and read-only card actions.
3. An `includeInProfile` toggle puts the blog's posts on the user's own profile, exactly
   as Mataroa's does today.
4. A CORS-blocked site gives a clear, specific error at subscribe time — not an empty feed.

## The precedent to copy exactly

`MataroaSettings` already solved this. It exposes:

```ts
readonly feedUrl = computed(() => {
  const blogUrl = this.blogUrl();
  return blogUrl ? new URL('rss/', blogUrl).toString() : null;
});
readonly includeInProfile = computed(() => ...);
```

…and `pages/profile/profile.ts:924-926` consumes it:

```ts
const mataroaFeed = this.mataroa.feedUrl();
if (mataroaFeed && this.mataroa.includeInProfile()) {
  feeds.push({ source: 'mataroa', url: mataroaFeed });
}
```

Do the same for Hugo: `HugoSettings.feedUrl` (`new URL('index.xml', siteUrl)`),
`HugoSettings.includeInProfile`, `setIncludeInProfile()`, and a third `feeds.push` in the
profile page. Follow the shape rather than generalizing it — two consumers do not justify
an abstraction, and a third blog connector arriving later is when to reconsider.

**This means `siteUrl` stops being optional-ish.** In sprint 1 it was a nicety for
permalink prediction; here it is load-bearing. The connector page should nudge for it
("add your site address to see your posts in your timeline") rather than requiring it —
publishing must keep working without it.

## Home timeline: subscribe, don't special-case

For Home, the Hugo feed is **an ordinary `RssFeedSub`**. Decision 7: no Hugo-specific feed
code, no Hugo entry in `ProviderId`, no new provider class. The connector page gets an
"Add my blog to my feeds" button that calls `RssSubscriptions.add()` with the site's
`index.xml` and the repo name as a title.

Consequences to accept rather than engineer around:

- It counts against the RSS subscription limit. Correct — it is a feed.
- The user can disable or remove it from the Feeds page like any other. Correct.
- If they remove it there, the connector page's button should offer to re-add rather than
  claiming it is still subscribed. Derive the button's state from
  `RssSubscriptions.feeds()` by URL match; never store a second "is subscribed" boolean,
  which would immediately disagree with reality.

## Feed discovery, and the two ways it disappoints

`<site>/index.xml` is the Hugo default, and it is wrong often enough to handle:

- A site with `baseURL` including a path (`https://user.github.io/blog/`) puts the feed at
  `.../blog/index.xml` — handled by resolving relative to the configured `siteUrl`, which
  is why we ask for the full URL with its path.
- Themes and `outputs` config can move or rename it (`feed.xml`, `rss.xml`, per-section
  feeds only).

So: **try `index.xml`, and if it 404s or does not parse, fall back to reading
`<link rel="alternate" type="application/rss+xml">` from the site's HTML.** That is one
extra fetch, only on failure, and it is the same discovery any feed reader does. If both
fail, say so and offer a manual URL field — which is just the existing Feeds page, so link
there.

## CORS is the real risk (exit criterion 4)

Per the roadmap's table: GitHub Pages sends `access-control-allow-origin: *`, so the
common case works. A custom domain behind Cloudflare or Netlify may not.

`rss-fetch.ts` already distinguishes CORS failure from a 404 and already has the per-feed
`useProxy` opt-in (`rss-subscriptions.ts:36-50`, deliberately never enabled on the user's
behalf). Sprint 3 adds **no new machinery** — it just makes sure the subscribe action
surfaces the existing error with copy that names the likely cause:

> Your site is reachable, but it doesn't allow other sites to read it from a browser.
> GitHub Pages does this by default; a custom domain may need a header. You can enable the
> CORS proxy for this one feed on the Feeds page.

Note the irony worth putting in a code comment: the *publish* path needs no proxy because
`api.github.com` is CORS-open, while the *read* path might, because the user's own site
is not. It reads as backwards and it is correct.

## Non-goals

- **No dedupe between the published Status and the RSS item.** Sprint 1 emits a local
  `blog:hugo:<slug>` Status on publish; the feed will later carry the same post as
  `rss:<feed>:<guid>`. They will briefly coexist. This is the same behaviour every other
  blog connector already has, the local one ages out of the timeline naturally, and
  cross-post dedupe is listed as a phase-4 stretch item in `roadmap-providers.md` for all
  providers at once. Do not solve it here for one connector.
- **No polling for "has my post appeared yet".** That is sprint 4's job, and it asks
  GitHub Actions, which is a much better source of truth than re-fetching RSS.
- **No parsing the site's HTML beyond the one `<link rel=alternate>` discovery fallback.**

## Test notes

- `feedUrl` derivation: site URL with a path, without a trailing slash, with query junk.
- Subscribe action: adds exactly one `RssFeedSub`; a second click does not duplicate;
  removing it on the Feeds page flips the button back to "add".
- Discovery fallback: 404 on `index.xml` → HTML fetched → `<link rel=alternate>` used.
- Profile: `includeInProfile` off → no feed pushed; on with no `siteUrl` → no feed pushed
  and no crash.
- Per the `rss-feed-cache` memory, feeds are cached in IndexedDB with a 24h TTL and specs
  must await the async lookup via `settleRssCache()`. Any spec here that goes through the
  RSS provider needs that, and forgetting it is a flake, not a failure.

## Handoff note

Self-contained and small. If it must be cut, cut the profile toggle (exit criterion 3) and
keep the Home subscription — the profile half is a two-line change that can land any time.
