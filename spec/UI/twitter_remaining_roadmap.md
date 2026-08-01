# Twitter provider — remaining roadmap

**Status:** §1–§5 shipped; §6 bulk import shipped, rotation remains
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
| 150 (a normal Twitter following list) | $0.009 | $0.27 |
| 1,000 | $0.06 | $1.80 |
| 5,000 | $0.30 | **$9.00** |

**This changes the answer to question 6 below.** 5,000 friends is not
economically absurd — it is a $9/month hobby, which is less than most streaming
services. The binding constraint is not credits; it is **rate limits and
wall-clock time**, which is a completely different problem with a different
solution.

---

## 1. Caching — are we as aggressive as RSS? — **DONE (2026-08-01)**

**Now yes.** Timelines persist to IndexedDB (`providers/twitter/twitter-cache.ts`),
so a reload no longer costs a request per followed account. Kept below for the
reasoning; the original analysis follows the summary.

| | RSS | Twitter (now) |
|---|---|---|
| Store | IndexedDB, survives reload | IndexedDB, survives reload |
| Freshness TTL | 24 h (`ClientPrefs.rssCacheTtlHours`) | 5 min (`TIMELINE_TTL_MS`) |
| Retention | 24 h | 24 h (`CACHE_RETENTION_MS`) |
| Failure cooldown | Yes (`FAILURE_COOLDOWN_MS`) | Yes, 5 min, per handle |
| Stale-on-error | Serves stale rather than failing | Same |
| Refetch on navigation | No | No |

### How it was built

Two ages rather than one, because a single TTL cannot express what this needs:
5 minutes answers *"may I serve this without asking whether to refetch"*, and 24
hours answers *"is this still worth showing at all"*. Between the two an entry
is **stale**: rendered immediately, labelled "Saved posts from an earlier visit"
with a `Refresh (1 request)` button, and never refetched on its own.

The rule that makes it work: **a restored entry is never refetched
automatically, however old it is.** A plain age test would have made every cold
start bill one request per followed account — exactly the cost the persistence
was added to remove. `shouldRefetch()` returns false for anything hydrated from
disk.

Two ordering traps, both real and both fixed:

- `timeline()` now waits on hydration before deciding to spend. Without it the
  very navigation this exists to make free — a cold page load — raced the disk
  read, missed, billed, and *then* had the saved copy arrive.
- The thread page does the same before its cold-load `getPost()`. A shared link
  opened after a reload used to always pay; now it resolves from disk when the
  post is in a saved timeline.

The in-memory `Map` stays the synchronous source of truth so `isCached()`,
`estimateCost()` and `findCached()` can still answer during render; IndexedDB
hydrates it once at startup and every successful fetch writes through.

**Verified in a browser**, counting every outbound request: first load makes one
`user/last_tweets` call, reload makes **zero**, and pressing Refresh makes
exactly one — via `user/tweet_timeline?userId=…`, proving the banked numeric id
survived the reload and made the refresh cheaper than the original lookup.

Also fixed while here: `toStatus` returned `url: null` when a response carried
neither `url` nor `twitterUrl`, which silently cost the post its "↗ Nitter"
link — the only way out of the app for a tweet. It now builds the permalink
from the handle and post id, both of which the guards already require.

### The original analysis

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

## 2. Clicking a post / clicking a profile — **DONE (2026-08-01)**

Both shipped, along with the toolbar. Kept here for the reasoning.

Also fixed while doing it: the per-post toolbar was almost entirely invisible on
tweets. Counts render under `caps.favourite`/`caps.reblog`, which are `false`
for Twitter *because the actions are impossible* — so the capability flag was doing
two jobs ("can you press this" and "is there a number worth showing") and got
the second one wrong. A new `readOnlyStats` concept separates them, and the
bookmark/translate/••• block now includes Twitter for signed-in readers, not just
anonymous ones. Real result on a live @AnthropicAI post (the translate button
became 🤖🌐 in §4, once it turned out the server one could only 404):

```
💬 1751 | 🔁 2115 | ⭐ 12504 | ↗ Nitter | 🔖 | 🤖🌐 | •••
```

**"Open original" is now "↗ Nitter"** for tweets, so a click goes to a
tracker-free front-end instead of x.com's login wall. The instance is
configurable (`providers/twitter/nitter.ts`) because the public Nitter
ecosystem is unstable — a hardcoded host turns a dead instance into a dead
feature.

Thread view fetches replies only, one request, with a free "full conversation on
Nitter" link instead of walking ancestors. A cold load (reload, shared link)
costs one extra request for the focus post; navigating from a card costs none,
because the post comes out of the feed cache.

**Two more envelope shapes found doing this.** The API now has four:

```
user/info                              -> { data: {...} }
user/last_tweets, user/tweet_timeline  -> { data: { tweets: [...] }, has_next_page, next_cursor }
tweet/replies                          -> { tweets: [...], has_next_page, next_cursor }
twitter/tweets                         -> { tweets: [...] }
```

`parseTimelineResponse` now accepts either nesting, and `parsePostsResponse`
handles the batch shape. Both are regression-tested.

### Threads: how it was built

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
post's replies only, show ancestors as "↑ Open the full thread on Twitter" rather than
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
the interesting one — Twitter shows it prominently and it has no analogue in the
fediverse. If it is wanted, it belongs in `providerRef` (which already survives
into the card) rather than bolted onto `Status`, so nothing outside
`providers/twitter/` learns a new field.

---

## 4. Parity with the anonymous read-only experience — **DONE (2026-08-01)**

**The prediction below was wrong on three of five rows.** "Built
provider-agnostic, so it should just work" held for the mechanisms that operate
on a `Status`; it failed everywhere a *gate* decided whether to show a control,
because every one of those gates was a denylist written before Twitter existed.

| Feature | Predicted | Measured |
|---|---|---|
| Local block/mute | Works | **Works.** Mute, Block and Report all offered; muting genuinely hides the post. |
| Reader mode | Should work | **Was broken.** Offered Reply/Boost/Favourite and a live composer. |
| Bookmark | Needs a decision | **Was broken.** Signed in, it POSTed a `twitter:` id to Mastodon. |
| Third-party translate | Works | **Was missing entirely** for a signed-in reader. |
| Filters | Should work | **Works.** They match on text, which tweets have. |

### What was actually wrong

**Reader mode offered impossible actions.** It chose its action row with
`isRss() || isAnonymousPublic()` — a denylist — so tweets landed in the
*writable* branch. A signed-in reader saw live 💬/🔁/⭐ buttons and, on clicking
reply, a composer armed with `inReplyToId="twitter:2083…"`. Now gated on
`readOnlyPost()`, derived from `capabilitiesFor()`, so the next read-only
provider is handled before it is written.

**Bookmarking a tweet was broken by signing in.** The code asked "am I
anonymous" when the real question is "does the home server know this post".
Measured in a browser:

```
POST /api/v1/statuses/twitter:2083317461269598348/bookmark   → 404, bookmark lost
```

An anonymous reader bookmarking the same post got a working local bookmark, so
signing in made the feature *worse*. Both callers now use
`serverKnowsStatus()`, and this also settles "the bookmark question" below in
favour of option (1) — the local store — which is where a Twitter bookmark was always
going to have to live.

**Translate disappeared entirely.** The server 🌐 button needs
`canUseServerActions`; the AI 🤖🌐 button needed anonymous mode. A signed-in
reader looking at a tweet therefore got *neither* — the capability vanished
rather than being unavailable. For a read-only provider **translate means "ask
the autorouter"**: the server has never seen the post, so only the client-side
AI path can work. The 🌐 button is now hidden for these providers and 🤖🌐 shown
regardless of session. Final toolbar on a live Twitter card: `🔖 | 🤖🌐`.

**"Open in chat" was offered** for an account that exists only on Twitter. Same
denylist, same fix.

All four are covered by regression tests that were confirmed to fail against
the old code — a test that passes either way proves nothing.

### The bookmark question — settled

Mastodon bookmarks are server-side; anonymous mode has `AnonymousBookmarks` in
localStorage. A tweet can only use the local kind, and the 404 above shows
what happens otherwise. Raindrop remains reachable through the existing "save
the post's first external link" path for anyone who wants it.

---

## 5. Home feed mix — **DONE (2026-08-01)**

Shipped. Tweets now interleave with Mastodon posts in one continuous feed,
sorted by date, with a 🐦 Twitter filter chip.

### The design changed on one insight

The plan below assumed merging would make spending **scroll-initiated** and then
tried to cap the damage. That framing was avoidable rather than inevitable. The
danger is real and worse than the plan states — `FeedAggregator.fetchForeignPage`
re-invokes `fetchPage()` *in a loop* until a source yields 20 posts or returns
empty, so a naive provider bills one request per followed account **per scroll**,
growing as the reader scrolls further.

The fix is to stop treating this provider as a fetcher. `TwitterProvider` is a
**reader of the cache**: it returns everything already saved in one page, then
reports exhausted, ending the aggregator's loop after exactly one call. Nothing
fetches on scroll, on focus, or on reconnect. Spending stays exactly where it
already was — an explicit "Refresh" — and the merge becomes free.

That makes constraints 2 and 4 unnecessary rather than merely satisfied: there is
no fan-out to cap and no daily limit to degrade against, because Home does not
spend. Constraint 3 (chip off by default) also drops: a chip that costs nothing
to leave on does not need to be hidden, and defaulting it off would have meant a
reader who connected Twitter saw nothing in Home and assumed it was broken.

The one concession is **`COLD_START_BUDGET = 3`**: a Home with *nothing* saved
fetches up to three accounts so a freshly connected reader is not staring at an
empty feed. Past that the section says how many accounts are unloaded and what
loading them costs, rather than quietly omitting them. Cold-start fetches run
sequentially — parallel requests through a free CORS proxy trip its per-origin
limit, and a throttled request fails having already been billed.

### Measured in a browser

| Action | Twitter API calls |
|---|---:|
| Cold Home, 2 follows, nothing saved | **2** |
| Reload | **0** |
| Scrolling four pages | **0** |

Card order on that load was `mastodon ×5, TWEET(NASA), TWEET(ESA)` — genuinely
merged by timestamp, not appended as a block.

### The original plan

1. **Reuse `FeedAggregator`'s existing round model.** It already fetches per
   source and merges by date, which is the right shape. Twitter contributes one
   page per account per round.
2. ~~Cap the fan-out per round independently of the follow cap.~~ Unnecessary:
   there is no per-round fan-out.
3. ~~The chip must be off by default.~~ Reversed: the merge is free, so hiding it
   only makes the feature look broken.
4. ~~Respect the daily hard limit, degrading to cache-only.~~ Unnecessary: Home
   is already cache-only.

---

## 6. The 5,000-friends problem

### Bulk import — **DONE (2026-08-01)**

On the Twitter connector: enter a handle, pull in who they follow, review, import.
Nothing is followed until Import is pressed.

**Two costs, nothing alike.** `user/followings` returns 200 accounts per request
and moved the credit balance by less than its resolution — 5,000 follows is ~25
requests and no meaningful money. Liveness is one request *per account*, and
there is no bulk alternative: **no endpoint on this service reports a last-tweet
timestamp**, and `created_at` everywhere is when the account was created. So
"skip dead accounts" is the expensive half and is opt-in.

**Free exclusions run first**, straight off the list: `statuses_count === 0`
(never posted) and `protected` (unreadable). Both remove real accounts from the
candidate set before any per-account request is spent.

**The pace is discovered, not assumed.** The first cut hardcoded 5.2s from the
free tier's stated limit:

```
{"error":"Too Many Requests","message":"For free-tier users, the QPS limit
 is one request every 5 seconds."}
```

Note *"for free-tier users"*. On a paid balance, twenty back-to-back requests all
returned 200. `TwitterPacer` therefore starts fast and backs off only on
evidence: obey `Retry-After` when sent, otherwise double up to a ceiling, then
ease back after a clean streak. Measured effect on the same 3-account check:
**~1 sec and 0.9s actual**, where the constant predicted "~1 min" and took ~16s.

There are **no rate-limit headers to read** — none on success, none on a 429,
only an occasional `Retry-After`. The pacer accepts a remaining-quota reading
for the day they appear, without depending on them.

A rate-limited account is **retried, not skipped** (measured: 4 requests for 3
accounts under a 429, same final result), because a refused request did no work
and moving on would silently drop someone from the import.

Archive-zip import is deferred; `ui/src/app/twitter-archive.ts` already parses
the format if it is picked up later.

### Rotation — still open

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

**DONE (2026-08-01):** the cap is now 200 — one `followings` page — and the
connector page warns past 50 that a full refresh takes a while. The computed
cycle time waits on rotation.

### The import path — **built**, see above

The prediction held exactly: `user/followings` returns 200 per page, so a
5,000-account list is ~25 requests. What the plan missed is that *importing* is
cheap while *vetting* is not — liveness has no bulk endpoint — which is why the
shipped feature separates the free filters from the opt-in per-account check.

---

## Suggested order

1. ~~Profile links + thread view (§2)~~ — **done**, with the toolbar and Nitter.
2. ~~Raise the follow cap (§6)~~ — **done**, 200.
3. ~~Persist the cache (§1)~~ — **done**, IndexedDB, verified zero requests on
   reload. It also made the thread view's cold-load fetch unnecessary in most
   cases, as predicted.
4. ~~Read-only parity audit (§4)~~ — **done**, and it found four real bugs
   rather than confirming the happy path: reader mode offered impossible
   actions, bookmarking a tweet 404'd once signed in, translate vanished
   entirely, and "open in chat" was offered for a Twitter-only account.
5. ~~Home feed mix (§5)~~ — **done**, and free: the provider reads the cache
   rather than fetching, so Home never spends. The main
   open question is ordering a merged feed when tweets arrive in bulk on a
   refresh rather than continuously.
6. ~~Followings bulk import (§6)~~ — **done**, with adaptive pacing and
   dead-account skipping.
7. **Rotation (§6)** — the last item. Now that Home reads the cache and never
   spends, rotation is purely about *when* to refresh a large follow list, not
   about protecting Home from it. Import is ~25 requests for 5,000 accounts; rotation is what
   makes keeping them fresh tractable. §1 makes the rotation far cheaper, since
   only the accounts due for a refresh cost anything.

`viewCount` (§3) is a nice-to-have that can ride along with any of these.
