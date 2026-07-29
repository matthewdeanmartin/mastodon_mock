# Anonymous Great — Sprint 2: clone friends list

Status: COMPLETE (implemented 2026-07-29; 1837 tests, lint and storage-registry clean). Roadmap: `anonymous-great-0-overview.md`.

## The premise

A fresh anonymous visitor has an empty Home feed and no obvious way to fill it. Meanwhile
every interesting profile they land on is carrying a hand-curated list of interesting
accounts: the people that profile follows. One menu item turns that into twenty follows.

## Why this is safe here and nowhere else (decision 3)

An anonymous follow is a row in `localStorage` (`AnonymousFollows.follow`). Cloning twenty of
them sends **zero write requests to anybody's server** — one read of `/following`, then
local state.

The same button for a signed-in user would fire twenty `POST /accounts/:id/follow` calls back
to back, which is indistinguishable from a follow-bot and is how accounts get suspended. So:

> **The menu entry is not rendered when signed in.** Not disabled, not rate-limited —
> absent. This is the feature's safety property, not an unfinished edge.

Do not later "finish" this by adding a delay and enabling it for authenticated users.

## Why it filters, and why filtering makes it page (decision 2a)

An anonymous follow slot is expensive in a way a server-side one is not.
`AnonymousMastodonProvider.createFollowFeed()` assembles the home feed with **one API call
per followed account**. Following someone who last posted eleven months ago spends a request
on every single feed refresh, forever, to return nothing. That is why
`ANONYMOUS_FOLLOW_LIMIT` is 50 rather than 5000.

So candidates are quality-gated. And because the gate removes candidates, one page of
`/following` (Mastodon caps `limit` at 80) can easily yield fewer than the twenty keepers we
want — so we page until we have enough or run out of pages.

The scoring is **free**: `/following` returns full `Account` objects, and both signals we
need are already on them (`models.ts:46-47`):

- `statuses_count` — do they post enough at all
- `last_status_at` — did they post *recently*

No extra request per candidate. This is the difference between a feature that costs 1 read
call and one that costs 80.

### `follow-quality.ts`

Its own module, not a predicate inlined in the clone flow: "is this account worth a feed
call" is a question the starter kits and any future follow-suggestion surface will want too.

```ts
export interface QualitySignal {
  id: string;
  /** Why this account was skipped, for the report. Null when it passes. */
  reject(account: Account, now: number): string | null;
}
```

A list of named signals, evaluated in order, first rejection wins and is reported. Ship
with post-frequency and leave the list obviously extensible — Matthew expects more signals
later, and the shape should make adding one a one-entry change.

Shipping signals:

| Signal | Rejects when | Message |
|---|---|---|
| `dormant` | `last_status_at` older than 120 days, missing, or unparseable | `hasn't posted in 8 months` / `has never posted` |
| `too-quiet` | `statuses_count` under 20 (a missing count is not evidence) | `has only 3 posts` |

The two are independent and both matter: a year-dormant account with 40,000 posts is still
dormant, and a brand-new account that posted twice yesterday is still not worth a slot.
Thresholds are named constants with the reasoning attached, not magic numbers at the call
site.

Deliberately **not** signals: follower count (popularity is not quality, and this whole
feature exists to escape the celebrity-only default), `bot` (a good bot is a fine follow),
`locked` (irrelevant — we never send a follow request).

### `clone-friends.ts`

Pure. Given the pages fetched so far, the viewer's existing follows and the remaining slot
count, decide who gets adopted and whether to fetch another page.

**As shipped** (`CloneSelection`, not `CloneCandidates`; two fields were added once the
dialog needed to explain itself):

```ts
export interface CloneSelection {
  adopt: Account[];
  skipped: { account: Account; reason: string }[];
  /** Already followed — counted, but NOT reported as a rejection. */
  alreadyFollowing: number;
  /** True when we want more, the last page was full, and pages remain. */
  wantsAnotherPage: boolean;
  /** True when the slot cap, not the target, was the binding constraint. */
  limitedBySlots: boolean;
}
```

`alreadyFollowing` is separate from `skipped` deliberately: "you already follow them" is
not a quality rejection and must not read as one in the dialog.

Rules:
- Drop anyone already followed (`AnonymousFollows.isFollowing`) and the viewer themself.
- Drop anyone failing a quality signal, keeping the reason for the report.
- Stop at the lower of the requested count (default 20) and the remaining slots under
  `ANONYMOUS_FOLLOW_LIMIT` — cloning must never be the thing that silently hits the cap.
- Page cap: **3 pages max** (240 candidates). An account following 5,000 people is not worth
  a 60-page walk, and the budget discipline here matches the search page's.

## The menu, reordered

Current order in `profile.html` is Report → hide boosts → remove follower → mute → block.
New order, per the TODO:

1. **Clone friends list** — anonymous only, and only when the account follows anybody
2. **(Un)hide boosts**
3. **Mute**
4. **Block**

**As shipped:** Report and Remove follower keep their `canManageRelationships` guard and moved
to the *end* of the menu — they are the rarest actions, and leaving Report at the top would
have kept the menu ordered worst-first. Final order is clone → (un)hide boosts → mute →
block → remove follower → report.

## The dialog

Confirm, then report. Bulk actions do not happen on a single click.

- **Before:** `Follow 20 of the 63 accounts @alice follows?` and, plainly, what was filtered:
  `14 skipped — dormant or too quiet.` with a disclosure listing them and the reason.
- **During:** a count. No network per follow, so this is fast, but 20 signal writes and a
  feed-cache invalidation is not instant.
- **After:** `Followed 20 accounts. Home feed will rebuild on your next visit.` and a link
  to Home. `AnonymousFollows.follow` already invalidates `AnonymousHomeFeedCache`.
- **Slot pressure:** when remaining slots < requested, say so up front — `You have 8 of 50
  follow slots left, so 8 will be added.`

## Files

- **New:** `ui/src/app/follow-quality.ts` + `.spec.ts`
- **New:** `ui/src/app/pages/profile/clone-friends.ts` + `.spec.ts`
- **New:** `ui/src/app/pages/profile/clone-friends-dialog/clone-friends-dialog.{ts,html,css}`
- `ui/src/app/pages/profile/profile.{ts,html}` — menu reorder, the entry, the paged fetch.

No new localStorage keys — this writes through `AnonymousFollows`, which already owns its key.

## Testing

- **`follow-quality`**: the boundary cases, especially the ones that look like they should
  pass — 40k posts but last post 400 days ago (reject), missing `last_status_at` (reject),
  posted today with 3 total posts (reject), and a normal healthy account (accept). Dates
  must be injected (`now: number`), never `Date.now()` inside the unit.
- **`clone-friends`**: dedupe against existing follows, self-exclusion, the slot cap
  interacting with the requested count, `wantsAnotherPage` false on a short page, and the
  3-page ceiling.
- **Profile component**: the menu entry absent when signed in — the safety property gets a
  test, so a future refactor that "tidies up" the guard fails loudly.

`npx ng test --no-watch`; `npm run lint` must pass.

## Demo script

1. Anonymous, fresh browser. Home feed is empty.
2. Find a well-connected account via search. `•••` → **Clone friends list**.
3. The dialog says how many it will follow and how many it filtered, with reasons. Confirm.
4. Home. A real feed.
5. Sign in. Visit the same profile, open `•••` — the entry is gone. That is deliberate.
