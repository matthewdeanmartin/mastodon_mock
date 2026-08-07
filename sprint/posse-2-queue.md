# POSSE — Sprint 2: Queue interactions, publish on demand

Status: COMPLETE (implemented 2026-08-06; 3330 tests, lint, prettier and both builds clean;
64 tests added). Roadmap: `posse-0-overview.md`. Depends on Hugo sprints 1–2.

## What changed during implementation

- **`PosseEntry` lost its planned `sourceUrl` and gained nothing else.** The plan's shape
  survived intact, including `targetUrl` being the field that can be silently wrong. It is
  taken from `Status.url` and an entry is **refused** when that is absent, rather than
  synthesising one — a made-up canonical URL is a dead permalink forever.
- **The queue seam is the success path of the existing toggle, not a wrapper.**
  `StatusCard.toggleFavourite` and `toggleReblog` now call one private `recordPosse()` from
  inside their `next` handler. Three consequences worth stating: a failed like records
  nothing (tested), un-toggling removes a still-queued entry (tested), and the HTTP request
  is byte-identical whether POSSE is on or off (tested, and the most important test here).
- **`posseEnabled()` requires a live connection, not just the checkbox.** The repo half can
  outlive the token (Hugo sprint 1's retention behaviour), and queueing records that could
  never be published would be a queue that only grows.
- **A publish that finds everything already recorded commits nothing.** Not in the plan.
  Re-publishing the same day from a second device would otherwise write an identical file,
  which is an empty commit and a pointless site rebuild. It still clears the queue, because
  the records *are* published.
- **A corrupt day file is reported, never overwritten.** `data/interactions/<day>.json`
  failing to parse throws with the path named, rather than silently replacing whatever is
  in there.
- **`POSSE_QUEUE_LIMIT` (500) was added.** The plan had no ceiling; an unbounded
  localStorage array fed by a UI button wants one.
- **Lint caught a rethrow with no `cause`.** This repo enforces `preserve-caught-error`;
  worth knowing when wrapping an error in the next sprint.

## Deferred to sprint 3, deliberately

The plan noted it, and it is now concrete: **replies are queueable in the data model but
nothing queues them yet.** `PosseKind` includes `'reply'` and the page renders reply text,
but the composer is not wired — a reply's record needs the `source` page design that
sprint 3 settles. Likes and boosts are the ones that queue today.

Mawkingbird only. When this lands, liking a post also records that like for your own site —
locally at first, committed when you say so.

## Exit criteria

1. A checkbox on the Hugo connector page turns POSSE on. **Off by default**, and the copy
   says plainly what it asserts: that the blog is set up to receive.
2. With it on, favouriting / boosting / replying also queues an interaction locally. The
   Mastodon (or Bluesky) action itself is unchanged — same request, same result, same
   failure modes.
3. A badge in the shell shows the pending count whenever anything is queued.
4. `/posse` lists every queued item with what it points at, and offers *Publish all* plus
   per-item remove.
5. Publishing commits the batch — **one commit for the batch**, not one per item — and
   clears what succeeded.
6. With the checkbox off, none of this exists: no queueing, no badge, no behaviour change.

## Why opt-in, and why a checkbox rather than a preference

Decision 2. The setting is not a taste ("I like recording my likes"); it is an **assertion
about the blog**: that it has a webmention endpoint, a template that renders these, and a
job pulling mentions in. Sprint 1 is the thing that makes it true. Ticking the box before
doing sprint 1 produces files nothing renders — which is not harmful, but is confusing, and
the copy should say so rather than pretending the box is free.

It lives on the Hugo connector page because that is where the repo it writes to is
configured, and because a POSSE setting with no repo behind it is meaningless.

## What a queued interaction is

```ts
export type PosseKind = 'like' | 'repost' | 'reply';

export interface PosseEntry {
  id: string;                 // local, for list keys and removal
  kind: PosseKind;
  /** The post being reacted to — the URL a webmention would target. */
  targetUrl: string;
  /** Enough to render the queue without re-fetching: who and what. */
  targetAuthor: string;       // '@alice@dmv.community'
  targetExcerpt: string;      // first ~140 chars, plain text
  /** Reply text. Empty for likes and reposts. */
  text: string;
  /** Which network the original lives on, for the queue's provider badge. */
  provider: ProviderId;
  queuedAt: string;           // ISO
}
```

`targetUrl` is the load-bearing field and the one that can be wrong. It must be the
**canonical public URL of the post**, not an API URL and not a Mawkingbird route:
`https://mastodon.social/@alice/12345`, not `/api/v1/statuses/12345` and not
`/thread/12345`. `Status.url` already holds this for every provider — use it, and skip
queueing entirely when it is absent rather than inventing one.

Storage: `mockingbird_posse_queue`, `account`-scoped (a POSSE record is a claim by one
persona), `private` sensitivity — it holds no credentials, only public URLs and your own
words. One `storage-registry.ts` row.

## The seam in `StatusCard`

The interaction handlers are the touch point, and the rule is **POSSE never affects the
primary action**:

```ts
// Existing path, unchanged: favourite on the network it came from.
this.actions.favourite(status).subscribe({ ... });
// Additive, and only when enabled. Local, synchronous, cannot fail the like.
this.posse.queueLike(status);
```

Ordering matters less here than in Hugo sprint 4 (nothing is on the wire), but the same
principle holds: a POSSE bug must never make a working like look broken. Queueing is a
localStorage write inside a try/catch that swallows quota errors — a full disk is not a
reason to fail a favourite.

**Un-liking removes the queued entry** if it has not been published yet. Liking and
immediately unliking should leave nothing behind. Once published, it is a commit in a repo
and this app does not chase it — the queue's job ends at publication.

## The badge and the page

Badge: same treatment as the `Drafts` nav item (`shell.html:108`), a count that appears
only when non-zero. Note the comment at `shell.html:47` — there is deliberately no
notification badge any more, so this is the only badge in the shell and should stay quiet
and small.

`/posse` — a page in the main routes, not under settings, because it is a *queue you act
on* rather than a thing you configure:

- One row per entry: kind icon, target author and excerpt, provider badge, relative time,
  a link out to the original, and a remove button.
- A header with the count and **Publish all**.
- Empty state that explains what would go here, since a user who arrives at an empty queue
  needs to know whether it is broken or just empty.
- Publishing shows per-item progress and leaves failures in the queue with their error.

## Publishing: one commit, not N

Exit criterion 5, and the reason queueing exists at all. All pending entries go into
**one file per day**, appended:

```
data/interactions/2026-08-06.json
```

`data/` rather than `content/`, deliberately: these are records Hugo renders as a list, not
pages that each deserve a URL. (The indieweb-purist alternative — one `content/likes/*.md`
per like, each with its own permalink — is more correct in theory and is a rebuild per
like, which decision 3 rules out.)

The write is Hugo sprint 2's update path exactly: read the file if it exists, keep its
`sha`, merge, `PUT` with that `sha`. All the concurrency handling already exists and is
tested. A 409 means the day's file changed underneath — re-read and merge rather than
overwrite, because the other writer is probably yesterday's queue from another device.

The queue is cleared only for entries the commit actually contains. A failed publish leaves
everything queued.

## Non-goals for this sprint

- **No sending.** Nothing is POSTed to anyone. That is sprint 3, and this sprint's output
  is what it will send.
- **No editing a queued reply.** Remove it and write it again.
- **No queueing from the anonymous session.** POSSE writes to a GitHub repo with a token;
  an anonymous reader has no Hugo connection. The checkbox is simply absent.
- **No rendering the interactions on the blog.** That is a `mistersql` template and belongs
  with sprint 1's work, not here. Note it in the sprint-1 follow-up when this lands.

## Test notes

- The queue store is pure-ish and gets straight unit tests: add, dedupe by
  `kind + targetUrl` (liking twice queues once), remove, clear-published-only.
- `StatusCard`: with POSSE off, favouriting issues exactly the same requests as today and
  writes nothing. With it on, the requests are *still* identical and one entry appears.
  That pair is the sprint's most important test.
- Publish: one `PUT` for N entries; a 409 re-reads and merges; a failure leaves the queue
  intact.
- Watch the two spec traps from the Hugo sprints (`vitest-fetch-spec-traps` memory):
  `clearAllMocks` alongside `restoreAllMocks`, and a fresh `Response` per call.

## Handoff note

The queue store plus its specs is the natural stopping point — it is self-contained, and
the UI (badge, page, publish) sits on top of it without changing it.
