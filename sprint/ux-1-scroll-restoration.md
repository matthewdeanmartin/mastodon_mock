# UX Sprint — Global scroll restoration

Status: **PLANNED** (written 2026-08-23, not started)

Deferred deliberately from the first-five-minutes batch, on the reader's own call:

> "Write up as a sprint plan. I'm reading towards us needing to consider this globally."

That instinct is right, and it is why this is not a one-page patch. Restoring scroll on
one screen is twenty lines; doing it so the app never lies about where you were is an
architectural decision about who owns list state.

## The symptom

Swipe-back (and browser Back) returns to a list at the top instead of where the reader
was. Reported most sharply for search, where the cost is highest — a result you scrolled
forty items to find is simply gone, and the only recovery is to scroll again through
results that may not even come back in the same order.

## Why the obvious fix is wrong

Angular ships `withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })`, one line
in `app.config.ts`. It does not work here, and it is worth being precise about why,
because it will look like the answer to whoever picks this up.

The router restores the scroll position **as soon as the navigation completes**, which is
before any of these pages have their content back. Every long list in this app is built
after the route resolves:

- `search.ts` re-runs the query from `queryParamMap` and repopulates `results()` /
  `accountItems()` asynchronously.
- `home.ts` calls `load()` in `ngOnInit`, then pages more in.
- `rss-page.ts` and the list pages restore from their own caches.

Restoring a scroll offset onto a 0-height page sets it to 0. The router then does not try
again, so the effect is exactly what happens today — with extra machinery.

`AnonymousHomeFeedCache` and `account-search-store.ts` already exist precisely because
this app knows its lists must be rebuilt on return. Scroll restoration has to hook into
*those*, not into the router.

## The shape

**One service, `ScrollRestoration`, keyed on the full URL including query params.**

Search at `?q=birds&type=statuses` and search at `?q=cats` are different lists and must
not share a position. This is the same key discipline `account-search-store` uses.

Three pieces:

1. **Record.** On navigation away, store `{ url, offset, contentHeight }`. Height is
   recorded so a restore onto a page that came back shorter can be recognised as
   unsatisfiable rather than clamped silently to the bottom.
2. **Restore, deferred to content.** The page tells the service when its list is
   populated; the service restores once and then forgets. This is the whole difficulty,
   and it is why every candidate page needs an explicit hook rather than a global
   listener.
3. **Expire.** A stored position older than a few minutes, or one whose page now has
   materially less content, is dropped. Restoring into the middle of a feed that has
   since refreshed puts the reader somewhere they have never been, which is worse than
   the top.

### Why pages must opt in

A global `scroll` listener plus a `router.events` subscription would cover every route
with no per-page work, and it is tempting. It cannot work here because only the page
knows when it is *done* — `results()` being non-null is not the same as the list having
rendered, and `home.ts` deliberately keeps paging after first paint. A service that
guesses will restore too early, which is indistinguishable from not restoring at all.

So: a small `restoreScroll(key)` call from each list page, at the point it already knows
its content is back. Four or five call sites, each one line.

## Scope, in order

| Page | Why it is on the list | Notes |
|---|---|---|
| `/search` | Named by the reader. Highest cost per loss. | Two shapes: `accountItems()` and `results()`. Both need the hook. |
| `/home` | The longest list in the app | Interacts with `load()` and the paging budget; restore must not trigger auto-fill. |
| `/rss` | Two-pane, long | The scrollable element is a pane, not the window. |
| `/lists/*`, `/tags/*` | Same shape as home | Cheap once the mechanism exists. |

Explicitly **out** of scope: threads and profiles. They are short, they are entered by
tapping one specific thing, and returning to the top of a thread is not a loss.

## Open questions to settle first

1. **Window or element?** `/search` and `/rss` scroll inside their own containers under
   the wide layout; `/home` scrolls the window. The service needs to take a target, and
   the pane cases need testing on mobile where the layout collapses.
2. **What about swipe-back specifically?** iOS Safari's interactive swipe-back has its own
   scroll behaviour and can fight a programmatic restore mid-gesture. Needs a real-device
   check — this cannot be verified in jsdom, and `.claude/skills/verify` drives a desktop
   browser.
3. **Does restoring re-trigger infinite scroll?** `home.ts` auto-fills when the reader
   nears the bottom. Restoring *to* near-the-bottom will fire it. Probably correct, but it
   must be a decision rather than a surprise.

## Testing

Unit-testable: the key derivation, the expiry rule, and that a restore is attempted once
and only once per navigation. Not unit-testable: whether the restore lands correctly,
which needs the `verify` skill and a real browser at two viewport sizes.

## Why this is worth a sprint and not a patch

Every page that opts in gains a way to be wrong — restoring to a stale offset on a
refreshed list is a new bug class this app does not currently have. The expiry rule and
the height check are what keep that from happening, and they are the parts a quick fix
would skip.
