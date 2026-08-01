# Sprint 2 — Notifications

Status: **DONE** (2026-08-01). 2699 tests pass, lint clean, production build
green. Grounded in the `app.bsky.notification.listNotifications` lexicon and
then verified against the live API — see "Measured" below.

## What shipped

- `bluesky-types.ts`: `BskyNotification`, `BskyNotificationPage`.
- `bluesky-api.ts`: `listNotifications`, `getUnreadCount`, `updateSeen`,
  `getPosts`.
- `bluesky-notification-adapter.ts`: reason→type mapping, `subjectUris`,
  `chunkUris`, `postsByUri`, `adaptNotification`.
- `bluesky-notifications.ts`: `BlueskyNotifications` — one page plus at most one
  batched hydration call.
- `notifications.ts` / `.html`: a `source` switch, shown only when a Bluesky
  account is linked. Audience filter, Accounts-New-to-Me, live toggle,
  open-in-chat and the who-liked dialog are all hidden on the Bluesky side
  rather than shown and broken; the type dropdown works for both unchanged.

26 new tests. Live end-to-end check against @mistersql: all 20 notifications in
a real page rendered, including a `repost-via-repost` whose subject is not a
post (renders without an excerpt, by design).

Demo: `/notifications` gets a source switch. Picking Bluesky shows
likes, reposts, follows, replies, mentions and quotes from Bluesky, in the same
rows the Mastodon list uses, with the same grouping, and clicking through lands
on the right thread or profile (both of which Sprint 1 made real).

## The lexicon, verbatim where it matters

```
app.bsky.notification.listNotifications  (query, requires auth)
  params:  reasons[]?  limit(1..100, default 50)  priority?  cursor?  seenAt?
  output:  { notifications[], cursor?, priority?, seenAt? }

#notification  required: uri, cid, author, reason, record, isRead, indexedAt
  uri           at-uri of the *notifying record* (the like, the reply, …)
  author        profileView  (already handled by adaptAuthor)
  reason        knownValues: like repost follow mention reply quote
                starterpack-joined verified unverified like-via-repost
                repost-via-repost subscribed-post contact-match
  reasonSubject at-uri of the post that was liked/reposted  (absent for follow)
  record        the notifying record itself, inline
  isRead        boolean
  indexedAt     datetime
```

Two corrections to the initial assessment, both from reading the above:

1. **`record` is inline and required.** The plan assumed one `getPosts` call to
   hydrate every notification. Not so — for `reply`, `mention` and `quote` the
   record *is* the post that was written, so it renders with no extra call.
2. **13 reasons, and `knownValues` is not a closed enum.** AT Protocol
   `knownValues` explicitly permits values outside the list. An unrecognized
   reason must render as a generic row, never throw.

## What still needs a second call, and why

For `like` and `repost`, `record` is the *like record* — `{subject: {uri, cid},
createdAt}`. Useful for nothing on screen. The post the reader wants to see is
`reasonSubject`, and that is a bare at-uri.

So: collect the distinct `reasonSubject` uris from a page and hydrate them in
**one** `app.bsky.feed.getPosts` call (max 25 uris per call — check the lexicon
at implementation time; if a page of 50 yields more than 25 distinct subjects,
chunk it). One extra call per page, not one per row.

`follow` needs no subject at all. `starterpack-joined` carries `starterPack`,
which we ignore in this sprint (see Deliberately out, below).

## Mapping to `MastodonNotification`

`models.ts:242` — `{ id, type, created_at, account, status? }`. `type` is a
plain `string`, not a union, which is lucky: the type filter dropdown is built
from `types()` over whatever arrived, so new values need no code change.

| bsky `reason` | `type` | `status` |
|---|---|---|
| `like` | `favourite` | hydrated from `reasonSubject` |
| `repost` | `reblog` | hydrated from `reasonSubject` |
| `like-via-repost` | `favourite` | hydrated from `reasonSubject` |
| `repost-via-repost` | `reblog` | hydrated from `reasonSubject` |
| `follow` | `follow` | none |
| `mention` | `mention` | `adaptPost` over the inline record |
| `reply` | `mention` | `adaptPost` over the inline record |
| `quote` | `mention` | `adaptPost` over the inline record |
| `starterpack-joined` | `follow` | none |
| anything else | the raw reason string | none |

`reply` and `quote` both fold to `mention` because that is the Mastodon type
whose row already renders "someone wrote this post at you", which is what all
three are. `verified` / `unverified` / `subscribed-post` / `contact-match` fall
through the default arm and show as a generic row labelled with the raw reason —
honest, and unbreakable when Bluesky adds a fourteenth.

**Id:** `bsky:<notification uri>`. The notifying record's uri is unique per
notification, so grouping and dedupe work with no extra key.

**`created_at`:** `indexedAt`. The record's own `createdAt` is attacker-supplied
and can be arbitrarily far in the past or future; `indexedAt` is the AppView's.

## Design: a source switch, not a merged list

The Mastodon list and the Bluesky list stay separate. Merging them into one
chronological stream is rejected for this sprint because half the page's
controls cannot work across both:

- The **audience filter** (All / Friends / Followers) calls
  `api.relationships()` with account ids (`notifications.ts:271`). A `bsky:` id
  404s there. Bluesky's equivalent would be N `getProfile` calls.
- The **account actions** (follow / mute / block, `notifications.ts:400-435`)
  are Mastodon API calls. Follow could route to `BlueskyGraph` (Sprint 1);
  mute and block have no `BlueskyGraph` methods yet.
- **Live streaming** (`Streaming.open({stream:'user'})`) is a Mastodon
  WebSocket. Bluesky has no notification stream — it is polled.

So the switch sits next to the existing Notifications / Accounts-New-to-Me
segmented control, and on the Bluesky side those controls are hidden rather
than shown-and-broken. Grouping (`groupNotifications`) works unchanged, since it
keys on status id.

## Work

1. **`bluesky-notifications.ts`** (new, in `providers/bluesky/`)
   - `BskyNotification` / `BskyNotificationPage` types.
   - `listNotifications(cursor)` on `BlueskyApi`.
   - `getPosts(uris)` on `BlueskyApi`.
   - `adaptNotification(n, subjects: Map<uri, Status>): MastodonNotification`.
   - A `BlueskyNotifications` service: fetch page → collect distinct
     `reasonSubject` → one `getPosts` → adapt → return
     `MastodonNotification[]` + cursor.
2. **Unread count.** `app.bsky.notification.getUnreadCount` for a badge;
   `updateSeen` when the tab is opened. Check whether the shell's existing
   notification badge is Mastodon-specific before wiring.
3. **Page.** A `source` signal on `Notifications`; the list, `loadMore` and
   the empty state read from whichever source is active. Hide audience filter,
   account actions and the live toggle when `source() === 'bluesky'`.
4. **Polling instead of streaming.** If the live toggle is offered at all on the
   Bluesky side, it is a `getUnreadCount` poll on a slow interval (60s+), and it
   must be labelled differently from the Mastodon live toggle, which is a real
   push stream. Simplest honest option for this sprint: no live toggle, just a
   Refresh button.

## Measured against the live API (2026-08-01)

Run as @mistersql against `bsky.social` with a real app password. These replace
the "verify before building" list; all four questions are now answered.

**1. The entryway answers `listNotifications`. No PDS resolution needed.**

```
GET https://bsky.social/xrpc/app.bsky.notification.listNotifications?limit=20
→ HTTP 200, 20 notifications, cursor present
GET https://shiitake.us-east.host.bsky.network/xrpc/…   (the real PDS)
→ HTTP 200, byte-identical first record
```

So this is unlike chat (`bsky-chat-pds`), which is service-proxied and *must*
hit the PDS. Notifications are an AppView read like `getTimeline`. Use the
existing `BlueskyApi.get()` with no `serviceUrl` override.

**2. Live reason mix included one from outside the "big six":**
`{like: 8, reply: 9, follow: 2, repost-via-repost: 1}`. The 13-value table
below is not theoretical — a `-via-repost` variant showed up in the first 20
notifications of a low-traffic account.

**3. `record` is inline and is exactly what the table predicts:**

| reason | `record.$type` | `reasonSubject` |
|---|---|---|
| `like` | `app.bsky.feed.like` (keys: subject, createdAt) | the liked **post** |
| `reply` | `app.bsky.feed.post` (keys: text, langs, reply, createdAt) | the parent post |
| `follow` | `app.bsky.graph.follow` | **absent** |
| `repost-via-repost` | `app.bsky.feed.repost` (has an extra `via`) | see below |

So `reply` / `mention` / `quote` render from `record` with **no** extra call,
confirmed.

**4. ⚠️ `getPosts` silently drops non-post uris. Nine in, eight out.**

The `repost-via-repost` notification's `reasonSubject` was
`at://…/app.bsky.feed.repost/3mrsppjucxh24` — a *repost* record, not a post.
`getPosts` returned 8 posts for 9 requested uris, with no error and no
placeholder.

Two hard consequences for the adapter:

- **Never index-align** `posts[i]` with `uris[i]`. Build a `Map<uri, Status>`
  from the response and look up by uri.
- **A missing subject is normal, not an error.** The notification still renders;
  it just has no `status`. Do not blank the row or log noise.

Filtering the request to uris containing `/app.bsky.feed.post/` would also work
and saves a wasted slot, but the Map is needed regardless — a deleted post
disappears the same way.

**5. Batching:** 9 uris in one call was accepted. The documented cap is 25;
chunk at 25 and the cap is never hit in practice for a 50-item page.

**6. `priority` and `seenAt` are both returned** (`priority: false`,
`seenAt: 2026-08-01T22:09:54.756Z`), so `updateSeen` and the unread badge have
what they need.

## Tests

- Adapter: each reason → correct type; unknown reason survives and keeps its raw
  label; `like` picks up its hydrated subject; `follow` has no status;
  `indexedAt` wins over the record's `createdAt`.
- Service: one page → exactly one `getPosts` with the *distinct* subject uris;
  a page with no likes/reposts makes **no** `getPosts` call at all; chunking
  when over the cap.
- Page: switching source swaps the list; audience filter and account actions are
  absent on the Bluesky side.

## Deliberately out

- **Starter packs.** `starterpack-joined` renders as a plain follow. Showing the
  pack means a `starterPackViewBasic` card and a starter-pack page, which is
  Sprint 5 territory at the earliest.
- **Notification preferences** (`putPreferences`) — settings surface, separate
  concern.
- **Labels** on notifications. The app has no label/moderation UI for Bluesky.
