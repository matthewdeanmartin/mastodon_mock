# Anon Office — Sprint 2: local likes

Status: PLANNED. Roadmap: `anon-office-0-overview.md`.

## The premise, and the honest version of it

An anonymous reader cannot favourite. `AnonymousCapabilities.canUseServerActions` is false
without a token, so `status-card.html:409` renders the like count as a dead number next to a
star. The gesture every social app has trained into people does nothing here.

Matthew went looking for a way to make "this is good" mean something *offsite* — some
cross-instance endorsement signal — and found nobody is doing that. Correct: there isn't
one, and inventing one is a protocol project, not a sprint. So this is deliberately the
small version:

> A local like is a private reading signal. It never leaves the browser, it is never
> federated, and it is never replayed to a server when the user later signs in.

Which raises the fair objection: **isn't that just a bookmark?** Nearly. The difference is
what consumes it (decision 6):

| | Bookmark | Local like |
|---|---|---|
| Means | "I want to find this again" | "more like this" |
| Consumer | The reader, later | `AnonymousAlgoSource` |
| Exports | Yes — Raindrop, bookmark providers | **Never** (roadmap non-goal) |
| Volume | Deliberate, few | Cheap, many |

If local likes did not feed the algo feed they would be redundant and should not ship. The
algo integration is the justification, not a follow-on nicety — build it in this sprint,
not "later".

## Anonymous-only (decision 5)

A signed-in user has real favourites. A second private heart beside them is two affordances
for one gesture, and the merge question ("does my private like show in `/favourites`?") has
no good answer. Since a session is either anonymous or signed-in and never both, the
question never has to be asked: `/favourites` shows server favourites when signed in, local
likes when anonymous, and no code anywhere unions them.

Consequence to accept up front: **local likes do not survive signing in.** They stay in the
browser under `anonymous` teardown group. Do not add a "import your likes" migration later —
that is the replay-to-server behaviour this sprint rules out.

## Storage

`local-likes.ts`, modelled directly on `anonymous-bookmarks.ts` — same file shape, same
versioned state, same tolerant `loadState()`, same `bookmarkKey()`-style identity (prefer
`shown.url`, fall back to `provider:id`, always read through `status.reblog ?? status` so
liking a boost likes the post).

Store the **full `Status` snapshot**, exactly as bookmarks do. It is the reason
`/bookmarks` renders offline and without a server that would answer, and the likes page
inherits that for free.

```ts
const STORAGE_KEY = 'mockingbird_anonymous_likes';
```

Named `_anonymous_` on purpose: it is the naming convention for this data *and* it is what
puts it in sprint 1's `group: 'anonymous'` teardown. Register it in `storage-registry.ts`
as `private` — a like list is a taste profile, squarely the "tells someone about me"
category the registry's doc comment describes. **Add the registry entry in the same commit
as the service**; `storage-registry.spec.ts` fails otherwise, which is the guard working.

Cap: **500**, evicting oldest. Bookmarks are unbounded because they are deliberate; likes
are cheap and the algo only reads recency-weighted signal anyway.

## The button

`status-card.html` already has the seam. Today:

```
@if (caps.favourite) { …server favourite button… }
@else if (!caps.favourite && readOnlyStats) { …dead star… }
```

The `@else if` branch becomes the local like button when anonymous. Same position, same
count display (the server's count stays visible — it is real information — with the local
state as the button's own on/off). Distinct enough from the server favourite that a
screenshot is unambiguous, per the answered mock:

```
Anonymous:  ❤ (local)    🔖 (local bookmark)
Signed in:  ❤ (server)   🔖 (server)
```

Both use ❤ because they are the same gesture in sessions that never coexist. The title and
`aria-label` carry the distinction: `"Like (saved in this browser)"`. Do not add a badge or
a different glyph to warn the user their like is local — the tooltip and the likes page's
own header say it once, clearly, without decorating every post.

Also wire: keyboard shortcut parity with favourite (`hotkeys.ts`), and the status-card
tests' existing capability fixtures.

## The page

`/local-likes`, guarded by `anonymous-only.guard.ts` (it exists). Structurally a sibling of
`pages/bookmarks/` — reuse its list rendering rather than inventing a layout.

Header states the deal in one line, once: *"Liked in this browser. Private, never sent to
any server, and used to tune your algo feed."* Sort newest-first, with unlike inline.

Navigation: it belongs next to Bookmarks in the shell nav, visible only when anonymous.

## Feeding the algo feed — the part that matters

`AnonymousAlgoSource` currently supplies the anonymous snapshot that `algo-feed.ts` builds
from. It gains likes as an input, in two ways, both cheap:

1. **Liked authors are a candidate source.** An author the reader liked twice is a stronger
   signal than a hashtag they followed once. Treat liked-author accounts as a bucket
   alongside mutuals, respecting the existing `ALGO_MAX_CALLS` (28) budget — likes must
   **not** raise the ceiling. They compete for the existing budget; if that means fewer
   hashtag calls, that is the ranking working.
2. **Liked hashtags weight the hashtag bucket.** Tags extracted from liked posts get
   priority ordering within the existing `HASHTAG_RESERVE`. Zero extra calls: the tags are
   already in the stored `Status` snapshots.

Both need to degrade to exactly today's behaviour at zero likes — the reader with an empty
likes list must get the feed they get now, byte for byte. That is the first test.

`engagementScore()` is untouched. Likes influence *which posts are gathered*, not how
gathered posts are ranked against each other. Mixing a private signal into a public
engagement metric makes both harder to reason about, and `algo-feed.ts`'s comment about why
replies are square-rooted is evidence that this ranking has already been tuned carefully.

Surfacing: the algo feed's existing "why you're seeing this" line (`AlgoSource`) gets a
`'liked'` variant. A private signal steering the feed silently is the thing people hate
about algorithmic feeds; saying "because you liked @x" costs one string.

## Tests

- `local-likes.spec.ts` — add/remove/has, boost identity, cap eviction, corrupt-state
  recovery. Mirror `anonymous-bookmarks.spec.ts`.
- Status card: like button appears anonymous, server favourite appears signed-in, never both.
- `storage-registry.spec.ts` passes with the new key.
- Algo: zero likes ⇒ unchanged output; liked author appears as a source; `ALGO_MAX_CALLS`
  never exceeded with a large likes list (the budget test is the important one).
- Sprint 1's `clearAnonymousData()` removes the likes key.

## Done when

- An anonymous reader can like, the like persists a reload, and `/local-likes` lists them.
- The algo feed demonstrably shifts toward liked authors, and says why.
- Signed-in behaviour is bit-for-bit unchanged.
- `npm run test:ci` clean.
