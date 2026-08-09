# QoL sprint 3 — collections: follow state and follow buttons

## The gap

`pages/collection/collection.html` has a feed tab, a members tab, and a convert-to-list
button — and **no follow affordance anywhere**. Grepping the template for "follow"
returns nothing. A collection is a curated list of people whose entire purpose is to be
followed, and the page will not let you follow any of them.

Worse, it doesn't say who you *already* follow, so the only way to work through a
collection is to open each member in a new tab.

## What exists to build on

`feed-members/feed-members.ts:73–90` already does the hard half: one batched
`api.relationships(ids)` call, signed-in only, `followingIds` as a `ReadonlySet<string>`,
`null` when unresolved or anonymous. It exposes `isFollowed(row)` and `knowsFollows()` —
but renders no button.

So the shared piece is worth extracting properly rather than copied a third time.

## Build: a `FollowButton` component + a follow-state service

**`follow-state.ts`** — batched relationship resolution for a set of account ids, with
the results cached per account id for the session and updated in place when a follow
succeeds. Mastodon caps `/accounts/relationships` at 40 ids per request
(`bulk-actions.ts:238` says 40; `feed-members.ts:14` says 80 — **resolve this
discrepancy**, 40 is the documented cap and the safe answer).

**`follow-button/`** — one small component taking an `Account`, rendering:

| State | Button |
|---|---|
| not following | **Follow** |
| following | **Following** (hover → Unfollow) |
| requested | **Requested** |
| anonymous | nothing, or a sign-in link — never a button that 401s |
| self | nothing |

It writes through `api.follow` / `api.unfollow` and updates `FollowState` optimistically,
rolling back on error with the failure visible. Locked accounts return `requested`, not
`following`; render what the server actually said.

Then use it in **both** places: each collection member row, and each `feed-members` row
(which currently computes follow state and does nothing with it).

## "Follow everyone in this collection"

A button at the top of the collection page. This is exactly the `list-follow` bulk
action that already exists (`bulk-actions.ts:157–170`) — the machinery for previewing,
pacing, rate-limit pausing and progress reporting is all built and tested.

- Add `collection-follow` as a `BulkActionId`, or generalise `BulkTarget` to carry a
  source kind (`{ kind: 'list' | 'collection', id, title }`). Prefer generalising:
  `fetchListMembers` is the only piece that differs, and the copy in the dialog's
  `effects` is nearly identical.
- Same confirmation dialog, which already states the real count — "will follow 23 of
  the 40 members; you already follow 17" — which is precisely the information the page
  is missing today.
- Reuse `BulkProgress`; the job survives navigation, as it does for lists.
- Anonymous: hidden entirely.

Note the existing memory that collection members carry `statuses_count` and
`last_status_at`, so the confirmation can also flag dormant accounts without extra
requests. Worth surfacing — following 40 accounts of which 12 last posted in 2023 is
information the user wants *before* confirming, not after.

## Convert-to-list

The report notes converting "is likely to fail". `list-collection-converter.ts` exists;
this sprint should at minimum make its failure legible — which member failed and why —
rather than a generic message. If the failure is that Mastodon requires list members to
be accounts you follow, then **follow-everyone must run first**, and the converter
should say so and offer it.

**Tests:** relationships batched at 40; follow button reflects `requested` for locked
accounts; optimistic update rolls back on error; the bulk preview counts only members
not already followed; anonymous renders no buttons and issues no relationships call.
