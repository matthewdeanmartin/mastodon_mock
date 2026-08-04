# Roadmap — the read-only reader gets to keep things

Status: PLANNED (2026-08-04). Decisions below are answered — see "Decisions taken".

## The pitch

`anonymous-great-*` made the read-only experience *work*: browser-local follows and lists,
honest search, clone-friends, translation. What it did not do is let a read-only reader
**carry anything over, keep anything private, or understand what they are looking at.**

Three gaps, in the order a real anonymous session hits them:

- **You land on a good profile and can take exactly one thing from it.** "Clone friends
  list" adopts their follows. Their *collections* — the part they hand-curated and
  published on purpose — are right there and there is no way to keep them, even though
  browser-local lists have existed since `anonymous-mastodon-sprint01`.
- **Leaving is a one-way door with no signage.** `Exit anonymous` and `Log out` fire
  immediately from the shell menu. There is no confirmation, and — more to the point —
  no way to say "and take everything with you". A reader on a machine that is not theirs
  has no exit that clears the trail, despite `storage-registry.ts` knowing every key we
  own and `portable-config.ts` knowing how to export them first.
- **"This is good" has nowhere to go.** An anonymous reader can bookmark
  (`AnonymousBookmarks`) but cannot favourite: `caps.favourite` is false, so
  `status-card.html:409` renders the like count as a dead number. Nobody on the fediverse
  offers an offsite "this is good" signal, so there is nothing to federate to — but the
  *local* signal is still worth having, because `AnonymousAlgoSource` is sitting right
  there waiting to be told what the reader actually likes.

And once the reader has follows, local lists, RSS and hashtags all feeding one Home, they
get the problem every aggregated feed has: **one loud account eats the window, and there
is no way to see that.** `feed-metrics.ts` already computes every number needed to say so;
nothing puts a verdict on it.

## What ships

| Sprint | The reader gets | Built on |
|---|---|---|
| 1 | `Copy account` — follows *and* collections in one action — plus a menu that separates keeping from destroying, and an exit that can take the browser data with it | `clone-friends.ts`, `AnonymousLists`, `storage-registry.ts`, `portable-config.ts` |
| 2 | Local likes: a real ❤ while anonymous, its own page, and an algo feed that weights what you liked | `AnonymousBookmarks` (shape), `AnonymousAlgoSource` (consumer) |
| 3 | Feed Doctor: who is flooding, why the feed ended, whether the sources are mixing | `feed-metrics.ts`, `algo-feed.ts` budget instrumentation |

## Non-goals

- **No server writes, still.** Everything here is `localStorage` and IndexedDB. `Copy
  account` stays anonymous-only for the same reason clone-friends does — twenty POSTs in
  a row is a follow-bot signature (`anonymous-great-2`, decision 3). Do not relax this.
- **No federated "like" signal.** Local likes are local. We are not inventing a
  cross-instance endorsement protocol, and we are not writing likes to any server later
  "once the user signs in". They are a private reading signal.
- **No Raindrop / bookmark-provider integration for likes.** Bookmarks are the thing you
  export somewhere; likes are the thing that tunes your feed. Keeping them distinct is the
  only reason having both is not redundant. Local likes offer no send-elsewhere action.
- **No new backend, no crowd-sourced anything.**
- **Feed Doctor does not silently change the feed.** It reports and offers one-click
  actions the user takes. It never auto-mutes.

## Decisions taken (from Matthew, 2026-08-04)

1. **`Copy account` replaces `Clone friends list`** and copies follows *and* collections in
   one shot with a combined report. No checkbox dialog — one action, one report. The
   existing clone-friends flow becomes the follows half of it; `clone-friends.ts` keeps its
   name and its tests.
2. **Collection members are quality-gated with the same gate as follows.** My earlier
   objection — "a list membership costs nothing per refresh, so why gate it" — was **wrong,
   and Matthew corrected it**: a browser-local list *is* a feed source, and rendering one is
   one API call per member via the same `createFollowFeed` machinery as Home. A dead account
   in a copied list therefore burns a call every time that list is opened. `AnonymousLists`
   stores `memberKeys` — follow keys — so copying a collection creates follow rows too;
   there was never a cost-free tier here. The gate is right for exactly the reason
   `ANONYMOUS_FOLLOW_LIMIT` is 50.

   Two consequences that still hold: **per-list skip counts are always shown** so a thin
   copy is never silent, and Mastodon's own cap on collection size keeps the copied lists
   small enough that the ceiling is not the binding constraint.

   **Verified live, anonymously, 2026-08-04** (see `anonymous-collections-readable` memory):
   `/accounts/{id}/collections` and `/collections/{id}` both return 200 with no token, and
   collection members arrive as full `Account` objects carrying `statuses_count` and
   `last_status_at`. So the gate costs **zero extra requests** here, the same bargain as the
   follows half. The "collections may be unreadable anonymously" fallback is not needed.
3. **The `•••` menu is divided *and* readable.** Two separate problems, both real:
   - **Spacing.** Matthew could not find `Clone friends list` in the menu he asked for,
     because the panel is a stack of buttons with no padding, no gaps and no grouping — it
     scans as a wall. Fixing the density is a prerequisite for the divider meaning
     anything; a rule between two illegible blocks is still illegible.
   - **Grouping.** Keeping actions (open on server, copy account) above the rule;
     destroying actions (mute, block, report, remove follower) below it. The menu currently
     reads as three ways to make someone disappear with one constructive action smuggled in
     at the top.
4. **Exit anonymous and Log out both confirm**, with **three** outs, not two:
   - *Return to login page* — keeps everything.
   - *Delete anonymous data only* — follows, local lists, local likes, anonymous bookmarks,
     anonymous prefs. Saved signed-in accounts and app settings survive. This is the shared
     machine where the reader has their own real account saved and only wants the
     read-only session gone.
   - *Remove all browser data* — every key `storage-registry.ts` owns, including saved
     accounts and tokens.

   Both destructive paths **offer an export first** via `portable-config.ts`, because the
   user who most wants a clean machine is also the one who most wants their follow list to
   survive the trip. The middle option is the one that needs to be *obviously* the safe
   destructive choice, since it is the one most people actually want.
5. **Local likes are anonymous-only.** A signed-in user has real favourites; a second
   private heart next to them is two affordances for one gesture. Anonymous and signed-in
   never coexist in a session, so `/favourites` simply shows whichever the current session
   has, and no merge logic is needed anywhere.
6. **Local likes feed the algo feed.** This is their justification for existing separately
   from bookmarks. `AnonymousAlgoSource` gets liked authors and liked hashtags as inputs.
7. **Feed Doctor is a new page** at `/feed-doctor`, built on `feed-metrics.ts`.
   `feed-analytics` stays as-is: it is descriptive ("here is the composition"), the Doctor
   is diagnostic ("here is what is wrong and here is the button"). Merging them would blunt
   both.

## Ordering, and why

Menu and dialogs first (decision: smallest risk, most visible, and the exit-confirm is the
one item here that is a *safety* fix rather than a feature). Likes second, because the algo
integration wants to land with enough runway to tune. Doctor last: it is pure analysis over
data the other two sprints make more interesting.

## Sprints

1. `anon-office-1-copy-and-exit.md`
2. `anon-office-2-local-likes.md`
3. `anon-office-3-feed-doctor.md`
