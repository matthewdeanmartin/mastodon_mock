# Sprint 5 — Bluesky feeds

Status: READY, **but has open questions for the user** (top of this document).
Depends on Sprint 4's `PeopleSource` refactor only in spirit — the pattern it
follows is `ListSource`, which already exists.

Demo at the end: the reader's pinned and saved Bluesky feeds — Discover, Popular
With Friends, whatever niche feeds they subscribe to — appear in the Lists tab
as first-class feeds, each opening into a normal timeline page.

## Why this sprint exists

User direction (2026-08-01):

> bsky has so many feeds, they're almost like alternative home feeds, which are
> kind of like lists but not quite.

That is exactly right, and it is the one place in this roadmap where Bluesky has
something Mastodon does not, so it is the one place where the plan needs a
decision rather than a derivation.

**A Bluesky custom feed is an algorithm hosted by a third party.** It has a
creator, a display name, a description, an avatar, a like count — and it emits
posts. It is not a member list: there is no "who is in this feed" to enumerate.

## Answered (user, 2026-08-01)

**A1. The Feeds tab, in their own section.**

> live feeds are going to be on the feeds tab, as far as my app is concerned
> they're yet another sort of feed. They'd get their own section.

That is the existing structure, not a new one: `pages/lists/lists.html` is
already a sectioned page (`showsSection('lists' | 'searches' | 'server' |
'collections' | 'tags' | 'featured-tags')`) behind `/feeds/*`. Bluesky feeds
become one more section beside "Server feeds" and "Saved searches", via a new
`ListSource` kind. No new page, no new navigation.

**A4. Both feeds and lists, as separate kinds** — if they really are different
things. They are:

| | Bluesky **feed** (`app.bsky.feed.generator`) | Bluesky **list** (`app.bsky.graph.list`) |
|---|---|---|
| what it is | an algorithm hosted by a third party | a curated set of accounts |
| members | none — only authors who happen to appear | real, enumerable members |
| posts from | `getFeed(uri)` | `getListFeed(uri)` |
| `memberOrigin` | `synthetic` | `real` |
| Mastodon analogue | none | a Mastodon list, near-exactly |

So: two `ListSource` kinds, `bluesky-feed` and `bluesky-list`, and **two
sections** on the Feeds page. Lumping them would be the "apples into round
holes" mistake — the members column alone means they render differently.

Lists are the better parity story (they map onto a Mastodon list), feeds are the
better novelty story. Both come from the same preference read, so the
incremental cost of the second is small.

## Still open

**Q2. Should a pinned Bluesky feed be able to feed the merged home timeline?**
User: *"uh... I'll have to read about pinned feeds."*

Deferred, and nothing in this sprint depends on it. For context when you get to
it: `savedFeed.pinned` is a boolean on each saved feed. In the official app,
pinned feeds become the tabs across the top of the home screen — so "pinned"
means "promoted to a top-level tab", not "merged into one stream". Bluesky
itself never merges them; you swipe between them.

Mockingbird's home feed *does* merge providers, so we could do something the
official app doesn't. That is the actual question, and it is a product call
rather than a technical one. **This sprint reads `pinned` and sorts pinned feeds
first within the section; it does not touch the home timeline.** That keeps the
option open in both directions.

**Q3. Feed discovery — how far?** Not asked again; the sprint takes the
conservative answer (read-only, saved/pinned only) and lists the rest under
"Deliberately out". Revisit after reads are proven.

## What the lexicons say

```
app.bsky.actor.defs#savedFeedsPrefV2
  items[]: #savedFeed { id, type: "feed"|"list"|"timeline", value, pinned }

app.bsky.feed.getFeed          { feed(at-uri), limit(1..100, d50), cursor }
                               → { feed[], cursor? }   error: UnknownFeed
app.bsky.feed.getFeedGenerators{ feeds[](at-uri) } → { feeds: generatorView[] }
app.bsky.feed.getActorFeeds    { actor, limit, cursor } → feeds created by actor

#generatorView  uri, cid, did, creator(profileView), displayName, indexedAt,
                description?, avatar?, likeCount?, viewer?, contentMode?
```

Key facts:

- **Discovery is a preferences read**, not a feed endpoint:
  `app.bsky.actor.getPreferences` → find `savedFeedsPrefV2` → each item's
  `value` is the feed's at-uri (or, for `type: "timeline"`, the special
  following feed). Then one `getFeedGenerators` call hydrates them all into
  display names and avatars.
- **`getFeed` output is `feedViewPost[]`** — the same shape `getTimeline`
  returns. So `adaptFeedItem` handles it **with no changes**. This is the reason
  the sprint is cheap: the hard part (adapting Bluesky posts) is done.
- `UnknownFeed` is a real error: third-party generators go down. A dead feed
  must degrade to a message, not an empty timeline that looks like "no posts".

Also needed for lists (A4):

```
app.bsky.feed.getListFeed  { list(at-uri), limit(1..100, d50), cursor }
                           → { feed[], cursor? }   error: UnknownList
                           "Does not require auth."
app.bsky.graph.getList     { list(at-uri), limit, cursor }
                           → { list: listView, items: listItemView[], cursor? }
#listView       uri, cid, creator, name(1..64), purpose, description?,
                descriptionFacets?, avatar?, listItemCount?, viewer?, indexedAt
#listItemView   uri, subject(profileView)
#listPurpose    modlist | curatelist | referencelist
```

`purpose` has **three** known values, not two:

- `curatelist` — "used for curation purposes such as list feeds". The only one
  that belongs in the Feeds tab.
- `modlist` — "apply an aggregate moderation action (mute/block)". Showing one
  as a readable feed would be actively misleading — it is a blocklist.
- `referencelist` — "for reference purposes such as within a starter pack".
  Not a feed either.

So filter to `curatelist` specifically, rather than filtering *out* `modlist` —
the allowlist is right when the enum can grow.

`getListFeed` **does not require auth**, like `searchActors`. Its error is
`UnknownList`, not `UnknownFeed`.

## Shape

`ListSource` (`lists/list-source.ts`) is a discriminated union of feed kinds
that each resolve to `ResolvedFeed { statuses, members, memberOrigin, hasMore,
warnings }`. Add two:

```ts
| { kind: 'bluesky-feed'; uri: string }   // algorithm — memberOrigin 'synthetic'
| { kind: 'bluesky-list'; uri: string }   // curated   — memberOrigin 'real'
```

The `memberOrigin` split is the whole reason these are two kinds rather than
one. For a feed, members are `authorsOf(statuses)` — an algorithmic feed
genuinely has no membership, only authors who happened to appear, and the
existing model already has a word for that. For a list, members are real and
come from `getList`, so the members panel enumerates them the way a Mastodon
list does.

Warnings carry the honest caveats: "This feed is run by @creator, not by
Bluesky" and, on `UnknownFeed`, "This feed's server is not responding."

## Work

1. `getPreferences()` on `BlueskyApi`; a `savedFeedsPrefV2` reader that tolerates
   unknown pref types in the union (there are 16 and the list grows).
   Partition `items[]` by `type`: `feed` → generators, `list` → lists,
   `timeline` → the follows feed, which we already have as `BlueskyProvider` and
   which must **not** be shown again as a saved feed.
2. `getFeedGenerators(uris)` and `getList(uri)` — hydrate names and avatars.
   Generators hydrate in one batched call; lists are one call each, so fetch
   them lazily (on section expand) if the reader has many.
3. `BlueskyFeeds` service: saved feeds and saved lists as
   `{uri, kind, displayName, avatar, creator, pinned}`, cached for the session.
4. `getFeed(uri, cursor)` and `getListFeed(uri, cursor)` on `BlueskyApi`; both
   adapt with the existing `adaptFeedItem` — both return `feedViewPost[]`.
5. `ListSource` gains both kinds; `ListFeedResolver` gains both arms.
6. **Two sections** on `/feeds/lists`: "Bluesky feeds" and "Bluesky lists",
   each badged 🦋, pinned entries first, feeds attributed to their creator.
   Keep only `purpose: curatelist`.
7. `UnknownFeed` / `UnknownList` → a warning row, not an empty state.

## Deliberately out of this sprint

- **Writing preferences** (pin/unpin/save from Mockingbird). Read-only first:
  a bug in a `putPreferences` write could scramble the feed list the reader
  relies on in the official app. Revisit once reads are proven.
- **Feed likes** (`generatorView.likeCount` / `viewer.like`).
- **`contentMode: contentModeVideo`** — video feeds want a different card.
- **Being a feed generator.** Out of scope forever; needs a server.
