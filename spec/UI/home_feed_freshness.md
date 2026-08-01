# Home feed freshness — merging many providers without a stale tail

**Status:** decided, not yet built
**Date:** 2026-08-01

## The problem, as reported

Home merges Mastodon, Bluesky, RSS, Twitter, and (for Anonymous) client-side
follows into one date-sorted feed. That works at the top and degrades badly
further down:

> `[new mastodon stuff/interleaved with bsky]` — these show up at about the same
> rate, so 20 posts from each, on average, show a mix. The normal experience is
> it is always something new.
> `[old, very, old, very very very old twitter stuff]` — RSS feeds have the same
> problem. When I scroll down, I get to stuff that I've already seen.

Two distinct failures, often confused:

1. **Rate mismatch.** Mastodon and Bluesky produce posts continuously; a
   followed Twitter account or an RSS feed may produce one a month. Sorting
   purely by date means the low-rate sources contribute nothing near the top and
   then dump their entire back catalogue once the high-rate sources run out.
2. **Unbounded page size.** Anonymous client-side follows fetch 20–40 accounts
   and merge them, producing (in the user's words) a *HUGE* page. Nothing bounds
   how much is loaded, only how it is sorted.

This is **one bug in the shared merge path**, not a Twitter bug. `FeedAggregator`
serves every provider, so RSS, anonymous follows and Bluesky all inherit it.

## Decisions

| Question | Decision |
|---|---|
| Mechanism | **Window chip in the filter bar** — Today / This week / Everything |
| Does the chip bound *loading* too? | **Yes.** Stop paging a source once it falls outside the window |
| Default | **Today**, remembered per user in `ClientPrefs` |
| What "Today" means | **Last 24 hours**, rolling — not since local midnight |
| Sources with nothing recent | **Silently omitted** from Home |
| Scope | **All providers at once**, in `FeedAggregator` |

### Why the chip bounds loading rather than only hiding

A pure display filter would leave both failures in place: the anonymous page
would still be huge, and Twitter would still spend its cold-start budget on
accounts dormant since 2019. Bounding the *fetch* is what actually fixes them,
and it makes the chip honest — "Today" then means "this feed contains today",
not "this feed contains everything with most of it hidden".

Cost of switching to Everything is a reload. That is free for RSS, Bluesky and
anonymous follows, and free for Twitter too, since `TwitterProvider` reads the
cache and never fetches on scroll.

### Why omitted rather than annotated

A source with nothing in the window simply does not appear. Nothing is lost: the
follow list still lists them and their profile page still shows their whole
timeline. A "3 quiet sources" footer was considered and rejected as furniture —
the feed should be the interesting posts, and the information is one click away.

### Why 24 rolling hours rather than since-midnight

"Today" at 00:05 would be almost empty and would jump discontinuously at the day
boundary. A rolling 24h window matches how someone actually reads a feed.

"Since you last opened Home" was considered — it is the only option that
*genuinely* never repeats — and rejected: it needs a persisted high-water mark,
is empty if you check twice in an hour, and behaves oddly across devices or
after a week away.

## Implementation sketch

- `ClientPrefs.homeWindow: 'today' | 'week' | 'all'`, default `'today'`.
- `FeedAggregator` gains a cutoff. A source is marked exhausted as soon as its
  newest unconsumed post is older than the cutoff, so paging stops naturally
  rather than being filtered afterwards.
- `TwitterProvider` already returns one page and reports exhausted; it just
  filters that page by the cutoff. Its `COLD_START_BUDGET` should skip accounts
  whose cached newest post is already outside the window.
- The chip goes in `home.html` next to Retweets/Replies. The bar is crowded, so
  it renders as a single chip with a dropdown rather than three chips.
- Changing the window calls `load()`, which is the existing refresh path.

## Rotation (Twitter, §6 of the Twitter roadmap)

Decided at the same time: **manual only, but smarter.**

Rotation is about *which* accounts get refreshed, never about *when*. Nothing
spends on its own — the rule the rest of the connector follows.

```
[Refresh oldest 20 (20 requests, ~20s)]
[Refresh all 200 (200 requests, ~3.5 min)]
```

Background refresh and refresh-on-open were both considered and rejected: they
spend money without an explicit press, and a forgotten open tab would bill the
user. The estimates come from `TwitterPacer`'s live interval, so they reflect
the plan actually in force.

Note the binding constraint is now the **CORS proxy**, not the data service:
Corsfix's trial allows 60 requests/minute, while a paid TwitterAPI.io balance
answered 20 back-to-back requests without throttling. A 200-account refresh is
therefore proxy-bound at ~3.5 minutes.
