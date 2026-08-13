# Bluesky-first — Sprint 6: anonymous Bluesky

Status: **COMPLETE (2026-08-13)**

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-5-search-parity.md](bsky-first-5-search-parity.md)

> The roadmap has referenced this sprint since 2026-08-11 but the file was never
> written. Written now, at build time, from a read of the code and a live probe
> of every endpoint involved.

## The framing that changed the sprint

The roadmap's one-liner was *"Browse Bluesky with no login at all, via
`public.api.bsky.app`"* — which reads as a Bluesky feature. The user reframed it
(2026-08-13), and the reframing is the sprint:

> "I think it is more single experience because if someone is too lazy to log
> into either mastodon or bsky, they can get both chips on the home page for both
> services and they should be able to search and follow people client side… and
> rss and so on. So quite a bit of functionality should just work, ignoring the
> chore of having to follow a few people to get a feed going."

So this is **not** an anonymous Bluesky mode sitting beside an anonymous Mastodon
mode. It is *one* anonymous experience that happens to contain both networks —
plus RSS, pastes, and everything else already in there. The person it serves is
someone who will not sign up for anything, and the deal offered to them is: do
the small chore of following a few accounts, and the app works.

That reframing decided the sprint's one real design question (below), and it is
the reason the follow list stayed a single list.

## What was already true

More than the roadmap implies. The anonymous account was **already** a
two-network shell:

- `AnonymousCapabilities.canUseBluesky` is `true`, and has been.
- `ProviderRegistry.linked` runs every linked provider for an anonymous session
  — Bluesky included; the comment there already records that it used to be
  filtered out and no longer is.
- `AnonymousMastodonProvider` is the template: a provider that is `linked` once
  the anonymous user has followed something, fanning out over their local follow
  list.

The gap was that Bluesky's half of that shell required an **app password**. This
sprint removes that requirement for reading and following.

## Endpoint probe (2026-08-13, live against `public.api.bsky.app`)

| Endpoint | Anonymous | Used for |
|---|---|---|
| `app.bsky.actor.getProfile` | **200** | profile pages |
| `app.bsky.feed.getAuthorFeed` | **200** | the anonymous home feed |
| `app.bsky.actor.searchActors` | **200** | finding people to follow |
| `app.bsky.graph.getFollows` | **200** | follow lists |
| `com.atproto.identity.resolveHandle` | **200** | handle → DID |
| `app.bsky.feed.searchPosts` | **403** | — refuses anonymous callers |

The 403 is worth recording precisely: it is **not** an API error. It is an HTML
block page (Cloudflare-style, `<title>403 Forbidden</title>`), served by
infrastructure in front of the endpoint. There is no error code to branch on and
nothing to degrade into — so the UI must never attempt it and must explain
instead.

## Locked decisions (user, 2026-08-13)

**1. One follow store with a `network` field, not a parallel Bluesky store.**

This is the decision that keeps it one experience, and the user picked it on
exactly those grounds. `AnonymousFollow` gains
`network: 'mastodon' | 'bluesky'`; `STATE_VERSION` 2 → 3 with v2 rows migrating
to `'mastodon'`.

The alternative — an `AnonymousBskyFollows` sibling — is smaller and needs no
migration, but it produces two follow lists and two counts, and every consumer
that shows "who you follow" (the hover card, `algo-feed`, bulk-add,
`import-follows`, the directory, feed-doctor, client-lists) would have to merge
them or silently show half. That is the road to two anonymous experiences.

**2. Post search: explain, offer account search, and hand off to the web.**

The user added the third option, which turned out to be the best one:

> "google et al still allow search for bsky. Not sure if the google variants are
> bsky aware or not. (see existing feature)."

They are, and the existing feature drops straight in. `serializeWebQuery` already
takes an arbitrary host for its `site:` scope — it was written for Mastodon
instances, but `site:bsky.app` works identically. Bluesky posts are public web
pages, so a Google/Bing/DDG/Kagi search finds them **with no account anywhere**.
That converts the one hard limitation into a working path rather than a dead end.

## What was built

### 1. Anonymous reads (`bluesky-api.ts`)

`getAuthorFeed`, `getProfile` and `resolveHandle` moved from `get` (session
required, throws without one) to `publicGet` (public AppView when signed out,
authenticated call when signed in). Behaviour for a linked account is unchanged;
the anonymous path is new.

Callers must treat a missing `viewer` block as *unknown*, not as "not following"
— that contract was already documented on `publicGet` and still holds.

### 2. One follow list, two networks (`anonymous-follows.ts`)

- `network` discriminator, `STATE_VERSION` 3, v2 rows migrated.
- `networkForAccount()` reads the namespaced id (`bsky:<did>`), so no extra
  parameter threads through the dozen call sites that pass an `Account` around.
- A Bluesky row is keyed by **DID**, not handle — handles are rentable.
- The row validator is now per-network. This was the trap: it required
  `origin(readRef.server)` to be truthy, and a Bluesky row has no instance
  origin, so every Bluesky follow would have been silently discarded on the next
  load. Bluesky rows validate on `readRef.accountId` starting with `did:`.

### 3. `AnonymousBlueskyProvider`

The sibling of `AnonymousMastodonProvider`: fans out over the Bluesky half of the
follow list, pages each author feed, merges newest-first, dedupes, and survives
one account failing.

Two things it deliberately does **not** do:

- **It does not mint a new `ProviderId`.** Its `id` is `bluesky`. The aggregator
  stamps `status.provider = provider.id`, and that id drives `PROVIDER_CAPS`,
  `serverKnowsStatus` and the status card. Anonymously-fetched posts are *real*
  Bluesky posts — same at-uri, and once the visitor links an account they can
  reply to the very same post — so a separate id would have declared all of that
  unknown territory and stripped the capabilities off every card. Write buttons
  still disappear while anonymous, via `AnonymousCapabilities`, which is the
  right place for that rule.
- **It does not run when a Bluesky account is linked.** `linked` requires
  `!session.linked()`. An anonymous visitor *can* link an app password, and once
  they have, `BlueskyProvider` serves their real timeline; both providers claim
  the id `bluesky`, and the aggregator dedupes within a provider, not across two
  that share a name. Without this the same posts arrive twice.

### 4. Search panel: anonymous posture

- **Account search** already worked anonymously and now drives local following.
- **Following is client-side.** `followUnavailable` replaces `!session.linked()`
  on the card: an anonymous visitor follows into `AnonymousFollows` and follow
  state is *exact*, not unknown. The genuinely unusable case is a signed-out or
  Mastodon-primary reader with no Bluesky link.
- **Post search** explains the limitation, offers account search, and now offers
  the **web-engine hand-off scoped to `site:bsky.app`**.

## Explicit non-goals

- Anonymous *writing* to Bluesky. There is no account to write with; linking an
  app password remains the way, and `AnonymousCapabilities` already removes the
  buttons.
- A local persona on Bluesky. Anonymous already has one browser-local identity;
  it does not need a second.
- Anonymous Bluesky DMs, notifications, or feeds-you-follow. All need a session.
- Working around the `searchPosts` 403. It is infrastructure, not API.

## Risks

| Risk | Mitigation |
|---|---|
| **Every Bluesky follow vanishes on reload**, because the row validator demands a Mastodon instance origin. | Per-network validation; spec'd explicitly as "survives a reload". |
| **Posts arrive twice** for an anonymous visitor who has linked Bluesky, since both providers claim `bluesky`. | `linked` requires `!session.linked()`; spec'd. |
| **Anonymous Bluesky posts lose their capabilities** by being tagged with a new provider id. | Reuses `bluesky`; spec'd that `provider.id === 'bluesky'`. |
| **v2 follow lists are discarded** by the schema bump, silently emptying Home. | Migration to `'mastodon'`; spec'd against a hand-written v2 blob. |
| A missing `viewer` read as "not following", producing duplicate follows. | Anonymous follow state comes from the local store, which knows exactly. |

## Exit criteria

All met.

1. ✅ `npm run test:ci` green (4035/4035); manifest clean.
2. ✅ An anonymous visitor can search Bluesky accounts and follow them, with no
   account on any network.
3. ✅ Those follows produce a Bluesky chip in the anonymous Home feed, merged
   with Mastodon/RSS/paste sources in one timeline.
4. ✅ Bluesky follows and Mastodon follows live in **one list** with one count.
5. ✅ Bluesky follows survive a reload.
6. ✅ Anonymous post search does not fire, and explains itself — with a working
   web-engine alternative.
7. ✅ An anonymous visitor who links Bluesky gets their real timeline and no
   duplicates.
8. ✅ A mastodon-primary session is unaffected.

## What is still a chore, and is meant to be

The user named it: *"ignoring the chore of having to follow a few people to get a
feed going."* That chore is real and this sprint does not remove it — an
anonymous Bluesky feed is empty until somebody is followed, because there is no
server-side following list to inherit.

Worth noting for a later sprint: the app already ships starter collections and a
bundled starter-kit mechanism for exactly this problem on the Mastodon side. A
Bluesky starter pack (`app.bsky.graph.starterpack`) is the obvious equivalent and
would turn the chore into one click. Out of scope here, recorded as the highest-
value follow-on.
