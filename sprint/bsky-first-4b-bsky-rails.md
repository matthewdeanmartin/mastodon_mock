# Bluesky-first — Sprint 4b: the rails speak Bluesky

Status: **COMPLETE (2026-08-12)**

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
2026-08-12, all three anonymous, no auth required. **Re-verified at build time**,
all three still 200:

| Endpoint | Returns | Use |
|---|---|---|
| `app.bsky.unspecced.getTrendingTopics` | topics with `displayName`, `description`, `link` | closest match to Mastodon's trending tags |
| `app.bsky.unspecced.getTrends` | same, plus `startedAt` and post counts | richer; better for a "trending" page |
| `app.bsky.unspecced.getPopularFeedGenerators` | custom feeds with creator, avatar, description | **no Mastodon equivalent at all** — this is a Bluesky-native widget worth having |

**A third caveat found at build time, and it is the one that would have bitten.**
These endpoints are **AppView-only**. `bsky.social` answers them
`401 AuthMissing` — *including for a signed-in caller* (measured 2026-08-12). The
app's existing `publicGet()` helper routes anonymous callers to
`public.api.bsky.app` but signed-in callers to the entryway, which is correct for
every endpoint it was written for and exactly wrong for these. Routing trends
through it would have broken them for precisely the accounts most likely to want
them — Bluesky-primary ones. So `PUBLIC_APPVIEW` is now exported and these three
endpoints address it directly, whoever is asking.

Two further caveats, called out in the plan and both upheld:

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

**As built:** `shell/network-sources.ts` — one predicate pair,
`usableMastodon()` / `usableBluesky()`, held by the rail.

A trap worth recording: the first cut wrote `usableMastodon` as "anonymous or
mastodon-primary, else opted-in connector", which quietly made it **false when
signed out** — and the shell renders the rail unconditionally, so every
logged-out visitor silently lost the Fediverse card and the donate block. Nine
specs caught it. The rule the predicate now encodes is narrower and safer:
**only Bluesky-primary has to opt in; every other state keeps exactly the rails
it had.** That is the standing regression clause expressed as code rather than
as a promise.

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

**Built as handle + PDS, no DID** (user's answer to open question 1). The DID is
the durable identity and it is public, so showing it would leak nothing — but it
is an opaque `did:plc:…` string that means nothing to most people, and the rail
is the scarcest space in the app. The entryway-vs-self-hosted distinction is
kept: it is the one piece of real information here for the kind of person who
runs their own PDS.

Reads `session.pdsUrl` when it has been resolved (chat resolves it via
`#atproto_pds` on plc.directory — see the `bsky-chat-pds` memory) and falls back
to `session.service` until something has asked, so the card never blocks on a
resolution it does not need.

### 3. New: Bluesky trends card

`getTrends` (falling back to `getTrendingTopics`), rendered as a list of topics
linking to the generated feed each one names. Hidden entirely when the endpoint
refuses.

### 4. New: popular feeds — on the Lists page, for **everyone**

`getPopularFeedGenerators`. Bluesky-native, with no Mastodon analogue, and it
plugs straight into the Lists/feeds work (`best-list-tab` memory) rather than
needing a new home.

**Not a rail card** (user's answer to open question 2). Two decisions, and the
second was the user's correction:

1. **Lists page, not the rail.** The Lists tab is already the hub for every
   custom feed, so this needs no new home, and the rail's scarce space stays with
   trends and the service card.
2. **Shown to every account kind, not just Bluesky ones.** The user's steer:
   *"is it not already on the lists/feeds page? if not add it for everyone."* It
   was not there — the page has three Bluesky sections and all of them are your
   *saved* feeds, which need your account. `getPopularFeedGenerators` is
   anonymous, so gating discovery on having a linked account would withhold
   public content for no reason. Verified at build time that the payoff is real:
   `app.bsky.feed.getFeed` also answers anonymously (200 against a real feed
   uri), so a Mastodon-primary or anonymous reader can not only see these rows
   but click through and read them.

This is the one place the sprint got *wider* rather than narrower, and it is
cheap: it reuses `BlueskyFeedEntry` and the existing `/feeds/bluesky/:ref` route
unchanged.

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

All met.

1. ✅ `npm run test:ci` green (4011/4011); manifest clean.
2. ✅ A bsky-primary account **without** a Mastodon connector sees **no** Just My
   Server, no donate block, no Mastodon server card, and no Mastodon trends
   links — and makes **no Mastodon API calls** from the rails. Spec'd as two
   tests, one asserting the absent markup and one asserting no `/api/` request
   is issued at all. The second is the load-bearing one: hiding a widget while
   still fetching for it would spend bandwidth on a declined network.
3. ✅ That same account sees a Bluesky service card naming its PDS, and a trends
   card, when the endpoints answer.
4. ✅ With **both** trends endpoints refused, the card is **absent**, not empty
   and not an error. The fallback path has its own test — refusing `getTrends`
   alone falls through to `getTrendingTopics`, which is the reason there are two.
5. ✅ A bsky-primary account that opts into the Mastodon connector gains the
   Mastodon widgets back — the Sprint 4 predicate driving the Sprint 4b chrome.
6. ✅ A mastodon-primary account has **byte-identical** rails and gains no
   Bluesky chrome it did not ask for.
7. ✅ A mastodon-primary account with Bluesky linked gains the Bluesky cards:
   `usableBluesky` reads `BlueskySession.linked()`, which is true for both of
   that class's roles (identity and connector) — see `bluesky-session-two-roles`.
8. ✅ House ads render in every combination, unchanged.

### What this sprint learned about widget space

Recorded for the crowding decision that was deferred, so it has evidence rather
than opinion behind it:

- **The swap is favourable, not neutral.** A bsky-primary account without a
  connector loses four Mastodon widgets and gains two Bluesky ones. The third
  planned Bluesky widget (popular feeds) went to the Lists page instead, so the
  rail is *shorter* for that account than it was — which is the right direction.
- **The genuinely crowded case is both networks connected**, and it is now an
  explicitly opted-into state on both sides. Those users get both sets, which is
  accepted and unsolved.
- **The service card is the weakest earner.** It is three lines of static text
  that never change for a given account, whereas trends are live. If something
  has to go when crowding is addressed, that is the first candidate.

## ~~Open questions~~ — both answered (user, 2026-08-12)

1. **Does the Bluesky service card show the DID?** → **Handle + PDS, no DID.**
   See §2.
2. **Popular feeds card — rail, or Lists page?** → **Lists page** — and the user
   sharpened the question: *"is it not already on the lists/feeds page? if not
   add it for everyone."* It was not, and it is now, for every account kind. See
   §4.
