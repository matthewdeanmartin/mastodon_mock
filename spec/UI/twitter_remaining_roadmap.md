# X/Twitter provider — remaining roadmap

**Status:** open questions answered, work not yet scheduled
**Date:** 2026-08-01
**Context:** Sprints 1–5 are merged (PR #13 + follow-ups). This document covers
what is left, with the cost arithmetic measured rather than estimated.

Companion documents: `sprint/twitter-0-overview.md` (the original plan),
`sprint/twitter-1-transport.md` (the CORS and provider measurements).

---

## 0. Measured costs — read this before the rest

Everything below depends on these, measured against the live API on 2026-08-01
by differencing the account credit balance across known calls.

| Operation | Records | Credits | Notes |
|---|---:|---:|---|
| `user/last_tweets` (one timeline page) | 20 posts | **6** | The unit that matters |
| `user/info` (one profile) | 1 | **<1** | Below the balance's resolution |
| `user/followings` (one page) | **200** | <1–2 | Page size is the surprise: 200, not 20 |

The account began with 10,000 bonus credits against a $0.10 budget, so
**1 credit ≈ $0.00001** and **one timeline refresh ≈ $0.0001**.

Scaling that up is the single most useful thing in this document:

| Follows | One full refresh | Once a day, per month |
|---:|---:|---:|
| 10 (today's cap) | $0.001 | $0.02 |
| 150 (a normal X following list) | $0.009 | $0.27 |
| 1,000 | $0.06 | $1.80 |
| 5,000 | $0.30 | **$9.00** |

**This changes the answer to question 6 below.** 5,000 friends is not
economically absurd — it is a $9/month hobby, which is less than most streaming
services. The binding constraint is not credits; it is **rate limits and
wall-clock time**, which is a completely different problem with a different
solution.

---

## 1. Caching — are we as aggressive as RSS?

**No, and deliberately less so in one dimension while being stricter in
another.** Worth stating precisely because the two providers optimise for
different things.

| | RSS | X |
|---|---|---|
| Store | IndexedDB, survives reload | In-memory, dies with the tab |
| TTL | 24 h (`ClientPrefs.rssCacheTtlHours`) | 5 min (`TIMELINE_TTL_MS`) |
| Failure cooldown | Yes (`FAILURE_COOLDOWN_MS`) | Yes, 5 min, per handle |
| Stale-on-error | Serves stale rather than failing | Same |
| Refetch on navigation | No | No |

### What is already right

- A failed handle is not re-billed on the next navigation — the single most
  important cost property, since a dead handle would otherwise cost a 404 every
  time its page is opened.
- Nothing polls. Nothing refetches on focus or reconnect. Refresh is always an
  explicit act.
- `estimateCost()` counts only what would really go to the network.

### What should change

**Move the cache to IndexedDB, like RSS.** The current in-memory cache means a
page reload costs a request per followed account, and reloads are frequent
during ordinary use (following a link out and coming back, restarting the
browser). At 6 credits a page this is the largest avoidable spend in the
product.

The original reasoning for in-memory — "media URLs expire, and persisting a
stranger's posts buys little" — was about *correctness*, and it was wrong about
the trade-off. Expiring media URLs argue for a shorter TTL, not for discarding
the text. Concretely:

- Persist the normalized `Status[]` per handle in IndexedDB, keyed like
  `RssCache`.
- Keep the 5-minute *freshness* TTL for "should I refetch", but keep entries for
  ~24 h for "what do I show while deciding".
- On a stale hit, render immediately and let the user press Refresh. Never
  auto-refetch on load — that turns opening the app into a bill.
- Evict media URLs older than a few hours by re-fetching only when a card's
  image actually fails to load, rather than pre-emptively.

Effort: small. `RssCache` is the template and the shapes are already
serializable.

---

## 2. Clicking a post / clicking a profile

**Expected, and by construction rather than oversight** — but only half of it is
intentional.

### Threads: genuinely not implemented

`StatusCard.threadable` holds an explicit allowlist:

```ts
return provider === 'mastodon' || provider === 'bluesky' || provider === 'rss';
```

`'twitter'` is absent, so cards are inert rather than broken. Making them
clickable needs a `twitter:` branch in `pages/thread/thread.ts` alongside the
existing `bsky:` and `rss:` ones, backed by one of:

- `GET /twitter/tweet/replies?tweetId=…` — direct replies, cursor-paginated.
- `advanced_search` with `conversation_id:<id>` — a best-effort fallback that
  may include non-reply conversation posts (spec §6.9 says to mark it
  `best-effort`, not `complete`).

Cost: one request per thread open, 6 credits. Ancestors would cost one *more*
per level, which is why §6.10's recursion cap matters. Proposal: fetch the focus
post's replies only, show ancestors as "↑ Open the full thread on X" rather than
walking the chain. One click, one price, no surprises.

### Profiles: already work, but nothing links to them

`/accounts/twitter:@handle` renders — that is the Sprint 4 page with the 20
NASA posts on it. What is missing is that `StatusCard.accountLink` returns
`null` for `'twitter'`, so an avatar or display name is not a link.

This is a two-line fix and should be done with the thread work, because the two
together are what makes the content feel like part of the app rather than a
read-only widget. Note it also makes *unfollowed* accounts reachable — clicking
a retweeted author's name opens their profile, which costs a profile lookup plus
a timeline page. Acceptable, but the price should appear on the follow button.

---

## 3. Stats — does the API surface them?

**Yes, and they are already wired end to end.** This one is done.

The wire types carry `replyCount`, `retweetCount`, `likeCount`, `quoteCount`,
`viewCount`, `bookmarkCount`, and the normalizer maps the first three onto
Mastodon's fields:

```ts
replies_count:    tweet.replyCount   ?? 0,
reblogs_count:    tweet.retweetCount ?? 0,
favourites_count: tweet.likeCount    ?? 0,
```

Real values from the captured fixture: 244 likes, 34 retweets, 11 replies,
77,172 views. They render on cards today because `StatusCard` reads the same
fields it does for Mastodon.

**What is not surfaced, and could be:** `viewCount`, `quoteCount` and
`bookmarkCount` have no Mastodon equivalent, so they are dropped. `viewCount` is
the interesting one — X shows it prominently and it has no analogue in the
fediverse. If it is wanted, it belongs in `providerRef` (which already survives
into the card) rather than bolted onto `Status`, so nothing outside
`providers/twitter/` learns a new field.

---

## 4. Parity with the anonymous read-only experience

**Mostly free already, because those features were built provider-agnostic.**
Worth auditing rather than assuming, but the mechanism is right:

| Feature | Status for X posts |
|---|---|
| Local block/mute | **Works.** `LocalModeration` keys on the account, and `StatusCard.mutedLocally` filters regardless of provider. |
| Third-party translate | **Works.** `AiTranslate` operates on `status.content`, which X posts have. |
| Bookmark | **Needs a decision** — see below. |
| Reader mode | Should work; `content` is Mastodon-shaped HTML. Verify. |
| Filters | Should work; they match on text. Verify. |

### The bookmark question

Mastodon bookmarks are server-side; anonymous mode has `AnonymousBookmarks` in
localStorage. An X post can only use the local kind — there is no X account to
bookmark against, and reading public data cannot create one.

The honest options:

1. **Reuse the local bookmark store** for X posts. Simple, and consistent with
   anonymous mode. Risk: a bookmarked X post is a *reference*, and re-rendering
   it later costs a request unless the cache (§1) persists it.
2. **Bookmark to Raindrop** via the existing connector, which is already the
   "second place to save bookmarks". Arguably the better home for a link to
   something outside the fediverse.

Recommendation: (1) for consistency, with the persisted cache from §1 making it
actually work offline. (2) is already reachable through the existing
"save the post's first external link" path.

---

## 5. Home feed mix

`TwitterProvider` implements `FeedProvider` but is deliberately **not** in
`ProviderRegistry.all`. The blocker was cost controls, and those shipped in
Sprint 5, so this is now a one-line registry change plus a filter chip.

It should still be a conscious step, because merging changes the *shape* of the
spend:

- Today, spending is user-initiated: you open an account, you pay for a page.
- Merged, spending becomes **scroll-initiated**. Every "load more" fans out
  across every followed account that has run out of buffered posts.

Design constraints, in order of importance:

1. **Reuse `FeedAggregator`'s existing round model.** It already fetches per
   source and merges by date, which is the right shape. X contributes one page
   per account per round.
2. **Cap the fan-out per round independently of the follow cap.** Ten follows
   should not mean ten requests every time someone scrolls. Proposal: refresh
   the N least-recently-fetched accounts per round (N≈3), and serve the rest
   from cache — the same "catch-up" idea §7.2 describes.
3. **The chip must be off by default** on first link, so nobody discovers the
   merge by watching their balance drop.
4. **Respect the daily hard limit**, and when it is hit, degrade to
   cache-only with a visible note rather than an error per card.

---

## 6. The 5,000-friends problem

The most interesting question here, and the measurements change the answer.

### It is not primarily a cost problem

At 6 credits a timeline page, 5,000 follows is **$0.30 per full refresh, ~$9/mo
at one refresh a day**. That is a real cost but not a prohibitive one, and it is
the user's own money against their own reading. The instinct that "the numbers
don't work out" is right for *naive* refresh-everything-always, and wrong for
anything paced.

### It is a rate-limit and wall-clock problem

- TwitterAPI.io advertises up to 200 req/s, but the CORS proxy in front of it
  does not. Corsfix's free tier is **60 req/min**; CORS.SH's free tier throttled
  this app within a handful of page loads during development.
- At 60 req/min, 5,000 accounts is **83 minutes** of solid requesting.
- `refreshMany` is deliberately sequential (parallel fan-out is what tripped the
  proxy), so wall-clock time scales linearly.

So the design cannot be "fetch everyone"; it must be **"fetch a rotating subset,
forever"**, which is what you intuited.

### Proposed design: a refresh budget with rotation

```ts
interface RefreshPolicy {
  /** Accounts refreshed per rotation tick. */
  batchSize: number;          // default 5
  /** Minimum gap between ticks. */
  interval: number;           // default 30 min, foreground only
  /** Never exceed this many requests in a day. */
  dailyCap: number;           // reuses TwitterUsage.hardLimit
}
```

- Keep a `lastFetchedAt` per follow (the store already banks profile details on
  read, so this is one more field).
- Each tick, take the `batchSize` accounts with the oldest `lastFetchedAt`.
  That is a priority queue by staleness, and it self-balances: an account
  refreshed today sinks to the bottom automatically.
- **Foreground only.** No background sync, no service worker. Spending money
  while the app is closed is a line this app should not cross.
- Surface the cycle honestly: *"152 accounts, refreshed about every 15 hours at
  your current settings."* That number falls straight out of
  `follows / batchSize * interval`, and it lets the user tune the trade-off
  themselves rather than guessing.

### Raise the follow cap, but tie it to the daily limit

The current cap of 10 is a blunt instrument chosen when nothing else limited
spend. With rotation and a daily cap, the follow cap can rise substantially —
several hundred — because the *daily* limit is doing the real protecting.

Suggested: cap at 200 (one `followings` page, conveniently), warn above ~50 that
full freshness is no longer possible, and show the computed cycle time.

### The import path

If someone has 5,000 friends they will not type them in. `GET
/twitter/user/followings` returns **200 per page**, so importing a 5,000-account
list is ~25 requests — trivially cheap, and a much better experience than the
follow form. Worth building alongside the rotation work, with a clear warning
about what refreshing that many accounts implies.

---

## Suggested order

1. **Persist the cache (§1)** — biggest cost saving, smallest change, and it
   makes everything below cheaper.
2. **Profile links + thread view (§2)** — what makes the content feel native.
3. **Read-only parity audit (§4)** — mostly verification; catches anything that
   silently assumes Mastodon.
4. **Home feed mix (§5)** — needs §1 to be affordable.
5. **Rotation, raised cap, followings import (§6)** — the big one, and it wants
   §1 and §5 settled first.

`viewCount` (§3) is a nice-to-have that can ride along with any of these.
