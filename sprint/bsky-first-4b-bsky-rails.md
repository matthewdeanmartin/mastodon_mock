# Bluesky-first — Sprint 4b: the rails speak Bluesky

Status: PROPOSED (2026-08-12)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-4-mastodon-under-bsky.md](bsky-first-4-mastodon-under-bsky.md)

## The problem

Sprints 3 and 4 make the *feed* work for a Bluesky-primary account. The chrome
around it still assumes Mastodon, and says so on every page.

> "The rails show a lot of mastodon things and doesn't show the corresponding
> bsky things… trends, only-my-server, right-rail server badge."

Concretely, `right-rail.html` today renders, for **every** authenticated
account:

| Widget | For a bsky-primary user |
|---|---|
| **Just My Server** | Meaningless. Bluesky has no instances to narrow to; there is nothing to be "only" about. It also calls Mastodon list APIs the account may have no token for. |
| **Fediverse card** — News, Trending posts, All feeds | Mastodon trends endpoints. Empty or erroring without a Mastodon connector. |
| **Donate block** — donate to your server / your search server / Mastodon | Asks a Bluesky user to fund a Mastodon instance they do not use. |
| **Server info** — title, domain, version, active-users, "Share this server" | Describes a Mastodon instance that is not their home. |
| **House ads / endorsements** | Network-agnostic. Fine as-is. |

The user's judgement on that last row is explicit: **endorsement ads stay**.
They are not Mastodon-specific and they are the one thing in the rail that is
about Mawkingbird rather than about a network.

The same defect exists in reverse for a **mastodon-primary user who connects
Bluesky**: they gain a Bluesky source and no Bluesky chrome at all. This sprint
fixes the rails by *account kind and connector state*, not by hardcoding
"Bluesky mode", so both directions are covered by one mechanism.

## Does Bluesky have a trends equivalent?

The user asked. **Yes** — verified live against `public.api.bsky.app` on
2026-08-12, all three anonymous, no auth required:

| Endpoint | Returns | Use |
|---|---|---|
| `app.bsky.unspecced.getTrendingTopics` | topics with `displayName`, `description`, `link` | closest match to Mastodon's trending tags |
| `app.bsky.unspecced.getTrends` | same, plus `startedAt` and post counts | richer; better for a "trending" page |
| `app.bsky.unspecced.getPopularFeedGenerators` | custom feeds with creator, avatar, description | **no Mastodon equivalent at all** — this is a Bluesky-native widget worth having |

Two caveats to design around rather than discover later:

1. **`unspecced` means unstable by name.** These are not frozen API. Treat a
   404/400 as "this widget is not available today" and hide the card, exactly
   as `feedCaps.shows('trending-links')` already does for Mastodon instances
   that serve no trends. That pattern is already in the rail and is the right
   precedent.
2. **Trends are topics, not hashtags.** A Mastodon trending tag is `#foo` and
   links to a tag timeline; a Bluesky trend is a phrase linking to a generated
   feed. Do not force it into the tag UI — it is a different object and pretending
   otherwise will produce a broken link.

## Scope

### 1. Rail widgets become conditional on kind + connector

One predicate, read by the rail:

- `Just My Server`, the donate block, the server-info card and the Fediverse
  trends links: shown when a **usable Mastodon source** exists (mastodon-primary,
  or bsky-primary with a Mastodon connector opted in). Hidden otherwise.
- New Bluesky widgets: shown when a **usable Bluesky source** exists
  (bsky-primary, or mastodon-primary with the Bluesky connector linked).
- House ads: always, unchanged.

A user with **both** sees both. That is correct and is not a crowding decision —
see below.

### 2. New: a Bluesky service card

The counterpart to the server-info card, per the user: **the server widget
without the call to donate.** Bluesky has no per-instance donation model and no
instance to fund, so that block simply does not exist here rather than being
translated.

What it can honestly show: the PDS the account actually lives on (already
resolved via `#atproto_pds` on plc.directory — see the `bsky-chat-pds` memory),
the handle and DID, and whether the session is on the `bsky.social` entryway or
a self-hosted PDS. That last distinction is real information for the kind of
person who runs their own.

### 3. New: Bluesky trends card

`getTrends` (falling back to `getTrendingTopics`), rendered as a list of topics
linking to the generated feed each one names. Hidden entirely when the endpoint
refuses.

### 4. New: popular feeds card

`getPopularFeedGenerators`. Bluesky-native, with no Mastodon analogue, and it
plugs straight into the Lists/feeds work (`best-list-tab` memory) rather than
needing a new home.

## The crowding problem — deliberately deferred

> "The widget space is almost maxed out already, so we're going to have to defer
> what I'll do about crowding."

Agreed, and this sprint must not quietly decide it. Its rule:

- **Widgets are swapped, not stacked.** A bsky-primary user without a Mastodon
  connector *loses* four Mastodon widgets and gains up to three Bluesky ones —
  net neutral or better.
- The genuinely crowded case is **both networks connected**, which after the
  Sprint 4 reversal is an explicitly opted-into state. Those users get both sets
  and a longer rail, and that is accepted for now.
- **Non-goal:** a widget manager, reordering, per-widget hide, or a
  collapse-to-tabs rail. All are reasonable answers to crowding and all are the
  user's call, not this sprint's.

Write down what the sprint learns about which widgets earn their space, so the
crowding decision later has evidence instead of opinion.

## Related: search must default to the user's own network

Also raised, and it belongs to **Sprint 5** (search parity) rather than here —
noted so it is not lost:

> "I hope on the roadmap is for the bsky-first experience that search defaults
> to bsky search instead of mastodon search."

It is not, today. `pages/search/search.ts` has `blueskyMode = signal(false)` and
reaches Bluesky only when the user picks `bluesky-posts` from the type
`<select>`. So a Bluesky-primary account searching for anything gets Mastodon
results by default — from a connector that, after the Sprint 4 reversal, may not
even exist. Sprint 5 owns making the default follow the account kind.

## Explicit non-goals

- Any change to the left rail's navigation structure.
- The crowding fix (above).
- Bluesky *notification* parity, or any other page's chrome — rails only.
- Removing house ads or changing how they are selected.
- Anything for mastodon-primary users who have **not** connected Bluesky: their
  rails must be byte-identical.

## Risks

| Risk | Mitigation |
|---|---|
| **`unspecced` endpoints disappear or change shape.** They are unstable by name. | Treat any failure as "hide the card", following `feedCaps.shows(...)`. Never let a rail widget surface an error. |
| **A mastodon-primary user's rails change.** The standing regression clause. | The new predicate must be false for them unless they linked Bluesky; spec it. |
| **The rail makes API calls for a network the user has not opted into**, which is the exact cost the Sprint 4 reversal is about. | No widget fetches until its predicate says it will render. |
| **Trends get forced into the hashtag UI** and produce dead links. | Bluesky trends link to generated feeds, not tag timelines. Separate component. |
| **Both-networks users get an unusably long rail.** | Accepted and recorded, not solved. See crowding, above. |

## Exit criteria

1. `npm run test:ci` green; manifest clean.
2. A bsky-primary account **without** a Mastodon connector sees **no** Just My
   Server, no donate block, no Mastodon server card, and no Mastodon trends
   links — and makes **no Mastodon API calls** from the rails.
3. That same account sees a Bluesky service card naming its PDS, and a trends
   card, when the endpoints answer.
4. With the trends endpoint refused (simulated 400/404), the card is **absent**,
   not empty and not an error.
5. A bsky-primary account that opts into the Mastodon connector gains the
   Mastodon widgets back.
6. A mastodon-primary account with no Bluesky link has **byte-identical** rails.
7. A mastodon-primary account with Bluesky linked gains the Bluesky cards.
8. House ads and endorsements render in all four combinations.

## Open questions for the user

1. **Does the Bluesky service card show the DID?** It is the durable identity
   and it is public, but it is also an opaque `did:plc:…` string that means
   nothing to most people. Handle-only, handle + PDS, or all three?
2. **Popular feeds card — rail, or Lists page?** It is the one widget here with
   no Mastodon counterpart, and the Lists tab is already the hub for custom
   feeds. Putting it in the rail costs the scarcest space in the app.
