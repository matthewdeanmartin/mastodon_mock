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

## Open questions for the user

**Q1. Where do feeds live in the UI?**
- (a) **In the Lists tab**, as a new `ListSource` kind. Matches the existing
  "Lists tab = hub for every custom feed" model (`best-list-tab` memory) and
  Twitter's followed accounts, which went the same way. *Recommended.*
- (b) A separate "Feeds" page, closer to how the Bluesky app presents them.
- (c) As selectable home-timeline modes — a dropdown on /home swapping which
  algorithm feeds the page.

**Q2. Should a pinned Bluesky feed be able to feed the merged home timeline?**
Right now `BlueskyProvider` contributes `getTimeline` (the follows feed) to the
merged home feed. Should a reader be able to say "merge Discover instead of / as
well as my follows"? That is a genuinely new capability with no Mastodon
analogue, and it changes `FeedProvider` from one-provider-one-feed to
one-provider-many-feeds.

**Q3. Feed discovery — how far?** Minimum is "show the feeds I've already
saved/pinned". Beyond that: browse a creator's feeds (`getActorFeeds`), search
feeds (`getPopularFeedGenerators`, unspecified in the core lexicons), or
save/unsave from inside Mockingbird (a `putPreferences` write). Writing
preferences is the risky one — it mutates state the official app owns.

**Q4. Lists.** `savedFeed.type` is `feed | list | timeline`, so Bluesky *lists*
(`app.bsky.graph.list` — curated member lists, the real analogue of a Mastodon
list) come back through the same preference. They are arguably a better parity
target than algorithmic feeds, since they map exactly onto what a Mastodon list
is. Do we do lists in this sprint, feeds in this sprint, or both?

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

## Recommended shape (assuming Q1 = a)

`ListSource` (`lists/list-source.ts`) is a discriminated union of feed kinds
that each resolve to `ResolvedFeed { statuses, members, memberOrigin, hasMore,
warnings }`. Add:

```ts
| { kind: 'bluesky-feed'; uri: string }
```

`memberOrigin: 'synthetic'` — members are `authorsOf(statuses)`, which is
already a helper and is exactly right here: an algorithmic feed genuinely has no
membership, only authors who happened to appear. That the existing model has a
word for this is a good sign the fit is real.

Warnings carry the honest caveats: "This feed is run by @creator, not by
Bluesky" and, on `UnknownFeed`, "This feed's server is not responding."

## Work (assuming a = Lists tab, minimum viable Q3)

1. `getPreferences()` on `BlueskyApi`; a `savedFeedsPrefV2` reader that tolerates
   unknown pref types in the union (there are 16 and the list grows).
2. `getFeedGenerators(uris)` — one call hydrates every saved feed.
3. `BlueskyFeeds` service: saved + pinned feeds as `{uri, displayName, avatar,
   creator, pinned}`, cached for the session.
4. `getFeed(uri, cursor)` on `BlueskyApi`; adapt with the existing
   `adaptFeedItem`.
5. `ListSource` gains `bluesky-feed`; `ListFeedResolver` gains its arm.
6. Lists tab lists the reader's Bluesky feeds, pinned ones first, badged 🦋 and
   attributed to their creator.
7. `UnknownFeed` → a warning row, not an empty state.

## Deliberately out of this sprint

- **Writing preferences** (pin/unpin/save from Mockingbird). Read-only first:
  a bug in a `putPreferences` write could scramble the feed list the reader
  relies on in the official app. Revisit once reads are proven.
- **Feed likes** (`generatorView.likeCount` / `viewer.like`).
- **`contentMode: contentModeVideo`** — video feeds want a different card.
- **Being a feed generator.** Out of scope forever; needs a server.
