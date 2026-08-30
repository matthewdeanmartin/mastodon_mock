# P1 Sprint 3 — The bookmark tail becomes a button

Status: **DONE** (2026-08-29)

Third of three. Follows [[p1-1-people-paging]] and [[p1-2-end-of-feed-honesty]].
Same constraints: no layout work, no Playwright, vitest only.

## The brief

> "I have never seen the bookmark tail. However it is currently implemented, it is
> ineffective. I want a new button at the bottom that says, 'More' and right next to it
> 'Review Bookmarks' which will tack on a batch of bookmarks and at the end it will say
> 'more' or 'Review bookmarks' again and you get the next page of the feed or next page
> of bookmarks as appropriate and then rip out the bookmark tail code."

Plus two rulings that shaped the design more than the button did:

> "If the user has 0 bookmarks then don't show the button. Don't make that a chatty call,
> we don't want to do dozens of bookmark calls a day to constantly reaffirm that there is
> at least 1."

> "Keep cooldown, but in the settings, add a setting to 'ignore cooldown' for endurance
> doomscrolling. […] There needs to be some real friction not just a different label."

## Why the tail was never seen

It required `capActive()` — which needs the feed to hit `feedMax` **and** be inside the
60-minute cooldown — *and* a non-empty bookmark list, all at once. Outside that
coincidence it was dead code; inside it, it appended 40 bookmarks with no warning. Both
failure modes are the same mistake: the feature decided for itself when to appear.

Removed entirely: `bookmarkTail`, `visibleBookmarkTail`, `loadBookmarkTail`,
`BOOKMARK_TAIL_SIZE`, and the `loadBookmarkTail()` call inside `loadMore`.

## What replaced it

**`bookmark-presence.ts` (new).** Answers "does this reader have any bookmarks?" with an
asymmetric cache, exactly as specified:

- **Yes is permanent.** Someone who bookmarked once is someone who bookmarks. If they
  later delete every one, the button leads to an empty review — a trivial cost, and not
  one worth a request budget.
- **No expires after 24h.** New readers acquire bookmarks; a permanent "no" would hide
  the feature from them forever.
- **Anonymous costs nothing** — local rows, read synchronously.
- **A failure is not a "no".** It leaves the answer `null` (button hidden this session)
  rather than caching a wrong answer for a day over a network blip.

Result: **at most one request per day** for someone with no bookmarks, and **exactly one
ever** for someone who has them.

**The probe fires from `loadMore()`, not on feed load.** This matters more than it looks.
The button lives at the *end* of the feed and most sessions never reach it, so probing on
load would spend a request per session on a question most readers never ask — the thing
the brief specifically forbade. Pressing "Load more" is the first evidence someone is
heading for the end; the answer lands well before they get there, and a session that never
presses it costs nothing.

**`reviewBookmarks()`** appends 20 at a time, paged by the last held id, deduped against
what is already shown (a repeated boundary item would otherwise render twice under its own
bookmark label). A short page, or one that adds nothing new, ends it. An error stops
offering the button rather than inviting a retry loop; a reload re-arms it.

**Three places offer the button**, all gated on `canReviewBookmarks()` — has bookmarks,
not exhausted, not in server-only mode (where bookmarks from other servers would
contradict the one thing that mode promises):

1. Beside "Load more" — the pair from the brief. Each press re-renders both, so the reader
   alternates freely: a page of feed, a page of bookmarks, another page of feed.
2. At "You're all caught up" — the end of the feed is where saved posts are most welcome.
3. Inside the cooldown wall — reviewing what you already saved is not doomscrolling.

`.feed-more-actions` wraps rather than shrinks, so a narrow screen stacks the two buttons
instead of clipping their labels.

### The cooldown override

`ClientPrefs.ignoreFeedCooldown`, off by default, persisted, and `capActive()` returns
false when it is on. The control is a checkbox in **Settings → Blue → Feed size**, next to
the `feedMax` slider that causes the cooldown.

The friction is the point, and it is why the control is not at the end of the feed:

> "There needs to be some real friction not just a different label."

A "you should take a break — load more anyway?" button is a different label, not friction:
it is one click, in the moment, at the exact point of least resistance. Making the reader
go to Settings costs a deliberate trip and makes it a decision rather than a reflex. The
setting's hint says as much in plain words.

**Note for whoever revisits this:** cooldown and anti-flood are different features and the
boss has said so explicitly. Anti-flood is "one person posts every 2 seconds"; cooldown is
"you have been scrolling for 2 hours". Anti-flood remains **on hold** pending a decision
about its shape. Do not implement one under the other's name.

## Tests

`bookmark-presence.spec.ts` (6, new) — asks once with `limit=1`; never asks again after a
yes; a fresh "no" is trusted; a stale "no" is re-asked; a failure is not cached; anonymous
makes no request.

`home.spec.ts` (+5, −1) — nothing is asked until "Load more"; the pair appears only with
bookmarks; the button is hidden rather than dead; a press appends and nothing appends
before; a short page stops the offer. The reading-break pair covers the wall and the
override. The removed test is `hitting the cap tacks up to 40 bookmarks onto the bottom,
once`, replaced by one asserting the cap stops the feed and offers the button *without*
appending anything by itself.

| Gate | Result |
|---|---|
| **Full suite** (`npm run test:ci`) | **5483 tests, 0 failures** |
| Coverage | 69.82 / 70.17 / 64.92 / 73.43 — all above thresholds |
| `tsc` app + spec | clean |
| `npm run lint` | clean |
| `npm run check:storage` | 118 keys classified |
| `npm run test:source-integrity` | 421 spec files, 5410 declarations |

Manifest updated (`npm run test:audit:update`) — 34 added, 1 removed, all intentional.

## A trap that cost real time here

Spec files **share one jsdom realm and one module registry** (see
`docs/shared-jsdom-realm-in-tests.md`). Adding a `describe` block whose `beforeEach` calls
`TestBed.configureTestingModule` will throw *"the test module has already been
instantiated"* if any earlier suite left a TestBed standing — and then **every suite after
it fails wholesale**, with 34 failures pointing at code that is fine.

`TestBed.resetTestingModule()` at the top of each suite's `beforeEach` fixes it, and has
been added to all five suites in `home.spec.ts`. If you add a sixth, do the same.

Second trap in the same file: `BookmarkPresence` is a root singleton whose cache survives
between tests in that shared realm, so only the first test would ever see the probe
request. The fixture seeds `mockingbird_has_bookmarks_v1` in localStorage instead of
flushing a request — every test then starts from the same known state.

## For the next developer

**The Feed Doctor still cannot see the cooldown.** `diagnoseStopped` accepts
`cooldownActive` / `cooldownMinutes` and `feed-doctor-page.ts` passes `false` / `0`,
because the cooldown lives in Home's component state and resets on reload. Now that
`ignoreFeedCooldown` exists as a persisted pref, lifting the *state* (`maxHitAt`) somewhere
both surfaces can read is a small, well-defined change — and it is the last piece of
Sprint 2's reporting story.

**`feedMax` trim and all-sources-hidden are still log-only.** Both have a slot in
`FeedBounds`; neither is populated. Add them when someone hits one.

**Bookmark paging assumes id-descending order** from `/api/v1/bookmarks`, matching what
`pages/bookmarks/bookmarks.ts` already assumes. If a provider ever returns them otherwise,
both walkers break the same way — fix them together.

**Not done, and deliberately:** no "jump back to the feed" affordance after a bookmark
batch. The two buttons stay adjacent at the bottom, so the feed is one press away; adding a
third control to solve that would undo the simplicity the brief asked for. Revisit only if
alternating in practice turns out to feel lost.
