# Bluesky-first — roadmap

Status: PROPOSED (2026-08-11). Awaiting sign-off on Sprint 1.

## The pitch

Mastodon has shed something like two million monthly actives since 2023 and has
settled into a stable, unspectacular plateau. Bluesky is where a lot of the
people worth reading actually went. Mawkingbird exists to lead people *away from
Twitter*, and today it can only do that by first asking them to care about
Mastodon.

That is a bad funnel. A Bluesky user who lands here is told, in effect: pick a
Mastodon server, get a token, and then — in Settings, three clicks deep, under
"Connections" — you may attach the network you actually use.

So: **a person must be able to open a fresh browser, log in with Bluesky and
nothing else, and have a complete, coherent app.** Mastodon becomes the thing
they add later, if ever.

This is not "make Bluesky better". Bluesky content support is already good (see
`bsky_parity_000_overview.md` — five sprints, all landed). This is about
**identity**. Roughly 90% of the app's assumptions about who the user is are
Mastodon-shaped, and this roadmap unwinds them carefully.

## Standing constraints

Unchanged, and they are why several obvious shortcuts are rejected below.

1. **Client-side only.** No backend, ever (`mockingbird-client-side-constraint`).
2. **Nothing outside `providers/` learns another protocol exists.** Bluesky
   adapts into Mastodon's `Status`/`Account`/`Relationship` at the edge. This
   roadmap does **not** relax this — identity is the exception being carved, and
   it is carved in `auth.ts` and `account-scope.ts`, not in the page layer.
3. **Ids stay namespaced.** `bsky:<did>`, `bsky:<at-uri>`.
4. **Mastodon-primary users must not notice any of this.** Every sprint's exit
   criteria include "an existing Mastodon session behaves byte-identically".

## The decision that drives everything: account *kinds*

Confirmed with the user (2026-08-11).

> "It's both! There is a new kind of account in town, and it is bsky primary.
> The other kind is mastodon primary. The 3rd kind that is kind of there now is
> anonymous, which always was a poor fit for a mastodon-primary model of
> identity."

So the model is **not** "unscope the Bluesky session" (too small — forecloses
multi-account) and **not** "personas as {mastodon?, bluesky?} pairs" (too clever
— invents a container the user never asked for). It is:

**An account has a *kind*. The kind determines which network is primary. Every
other network attaches to it as a connector.**

```
AccountKind = 'mastodon' | 'bluesky' | 'anonymous'

mastodon-primary   Mastodon token is the identity.  bsky/RSS/etc. scope under it.   (today)
bluesky-primary    Bluesky DID is the identity.     mastodon/RSS/etc. scope under it. (new)
anonymous          Browser-local identity.          everything scopes under it.      (today, retrofitted)
```

This reading also **fixes an existing wart**. `Auth.mode` today is
`'mastodon' | 'anonymous'`, where `anonymous` is a special case bolted onto a
type whose name says Mastodon. `account-scope.ts` reflects the same strain: it
reads `ACCOUNT_MODE_KEY`, special-cases the string `'anonymous'`, and otherwise
hashes the Mastodon bearer token. Anonymous was always a poor fit for a
Mastodon-primary identity model. Generalising to *kinds* makes anonymous a
first-class citizen for the first time, as a side effect of making Bluesky one.

### What this means for storage scoping

`accountScopeSuffix()` is the load-bearing wall. Today:

| mode | suffix |
|---|---|
| anonymous | `_anonymous` |
| mastodon | `_<fnv1a(token)>` |
| neither | `''` |

After:

| kind | suffix |
|---|---|
| anonymous | `_anonymous` (unchanged — no migration) |
| mastodon | `_<fnv1a(token)>` (unchanged — no migration) |
| bluesky | `_bsky_<fnv1a(did)>` (new) |

The two existing suffixes are **byte-identical to today**, which is the whole
reason for this shape: no migration, no data loss, no "where did my RSS feeds
go" bug report. The new suffix only ever appears for an account kind that could
not previously exist.

The DID is hashed for consistency with the token, not for secrecy — a DID is
public. Hashing keeps suffix length bounded and the code path uniform.

### The awkward bit: the Bluesky session under a Bluesky-primary account

Today `BlueskySession` stores itself at `scopedKey('mockingbird_bsky_profile')`.
Under a bsky-primary account that is circular: the scope is derived from the
DID, which is inside the thing being scoped.

It resolves cleanly and the resolution is not a hack. A bsky-primary account's
**own** session is not a connector — it is the identity, and identities live in
the same place saved Mastodon sessions live: an unscoped stable, split
profile/secret exactly as `auth.ts` splits `SESSIONS_KEY` from
`SESSION_TOKENS_KEY`. A *connector* Bluesky link under a Mastodon-primary
account keeps living at the scoped key it uses today. Same class, two call
sites, and Sprint 1 makes that explicit rather than leaving it implicit.

## Sprint list

| # | Theme | Demo at the end |
|---|---|---|
| 1 | [Account kinds](bsky-first-1-account-kinds.md) | Nothing visibly changes — but `Auth` speaks kinds, and a bsky-primary account can exist in storage |
| 2b | [The front door, actually](bsky-first-2b-app-first-front-door.md) | A stranger opens the app and **is in it** — shell, rails, real posts — with the login question as a modal on top. **Blocks everything below.** |
| 2 | [The front door](bsky-first-2-front-door.md) — ~~COMPLETE~~ **re-opened, superseded by 2b** | Shipped a landing page instead of the app; see 2b |
| 3 | [Log in with Bluesky](bsky-first-3-bsky-login.md) | Fresh browser → bsky handle + app password → working app, no Mastodon anything |
| 4 | [The Mastodon connector](bsky-first-4-mastodon-under-bsky.md) — **COMPLETE** | That same session can *opt into* Explore, trends and tag timelines — and attach a real Mastodon account later |
| 4b | [The rails speak Bluesky](bsky-first-4b-bsky-rails.md) | A bsky-primary account's rails show **Bluesky** widgets — trends, server/service card, feeds — instead of Mastodon ones it cannot use |
| 5 | [Search parity](bsky-first-5-search-parity.md) | Bluesky search has facets, refine, saved searches — and looks like Mastodon search |
| 6 | [Anonymous Bluesky](bsky-first-6-anonymous-bsky.md) | Browse Bluesky with no login at all, via `public.api.bsky.app` |
| 7 | [Find your people](bsky-first-7-bridge-finder.md) | "Who that I follow on Mastodon is also on Bluesky?" — with match kinds, not just scores |

Ordering rationale: 1 is pure plumbing and unblocks everything. 2 is the biggest
single UX win in the roadmap and — importantly — **does not depend on any
Bluesky work**, so it ships early and benefits every visitor immediately; it
also builds the chooser that sprint 3 plugs into. 3 is the headline. 4 makes 3
feel like a whole app rather than a single-column reader. 5 and 6 are
independent of each other and can swap. 7 is last because it is the only sprint
that is genuinely new product rather than inversion of existing product, and it
wants 4 in place (it reads a Mastodon follow list).

Sprints 1 and 2 are independent of each other and could run in either order or
in parallel. Sprint 1 first is recommended only because Sprint 2's chooser wants
to know that a Bluesky account kind is real and coming.

**Move slow.** The user's words. Sprint 1 ships with zero user-visible change on
purpose. If it is not invisible, it is wrong.

## Product decisions (user, 2026-08-11)

- ~~**Bsky-primary login assumes anonymous mastodon.social.** Silently — no nag,
  no opt-in card.~~ **REVERSED 2026-08-12 — see below.**
- **But they must be able to attach a real Mastodon account later.** So the
  "Mastodon under Bluesky" slot is a real connector from day one, with anonymous
  as its default occupant, not a hardcoded anonymous special case. Sprint 3 owns
  this distinction and it is the reason Sprint 3 exists separately from Sprint 2.

### Reversal: the Mastodon connector is opt-in (user, 2026-08-12)

The 2026-08-11 decision above was "silently assume anonymous mastodon.social, no
opt-in card". The user has reversed it, and the reasoning is worth keeping
because it is not a preference — it is a cost argument:

> "Providing a bsky user with an automatically available anonymous mastodon
> experience creates costs (screen clutter) that the user didn't opt into."

That is right, and Sprint 2b is the evidence. A silent Mastodon connector does
not cost nothing; it costs **rail space, nav entries and a search default**, all
spent on a network the user did not ask for. The original decision was made
while thinking only about the *feed* — where an anonymous Mastodon source is
genuinely free and invisible. It is not free in the chrome.

So the connector becomes: **present but empty, and offered.**

```
Mastodon connector
├─ absent (default for bsky-primary)   ← nothing in the rails, nothing in search
├─ anonymous @ <server>                ← opted in, no credentials
└─ signed in @ <server>                ← opted in, with credentials
```

The offer is what Sprint 4 has to get right: *"Mawkingbird can search and read
Mastodon too — with or without a Mastodon account"*, surfaced where it is
relevant (an empty Explore, a search with no Mastodon results) rather than as a
launch nag. **Two credential levels, both opt-in**, per the user: without
credentials is a real, useful state and not merely a degraded one.

This changes Sprint 4's decisions 3 and 4 and its exit criterion 2; those are
annotated in that file.

**Built this way (2026-08-12).** The reversal landed before any code was written,
so `absent` is a real state in `MastodonConnector` rather than a flag bolted onto
a live connector — an untouched connector writes nothing to storage at all. Two
follow-on decisions were taken at build time: opting in **without credentials
lands on `mastodon.social` immediately** (one click to a working Explore, change
server afterwards), and **Settings is the only opt-in surface this sprint** — the
contextual offers get their predicate but no UI. See Sprint 4's "What the next
sprint inherits".
- **Search: parity of *features*, not of *code*.**

  > "I don't mind if we have to reimplement all the faceting and so on because
  > the data models are just not going to match up or evolve at the same pace,
  > but as much as possible they should look the same. Right now, the previous
  > developer didn't even try to make them have feature parity. You don't have
  > to create a codesharing monster to have feature parity."

  This **upholds** the 2026-08-01 decision not to share query code, and
  **rejects** what that decision was used to justify — a Bluesky panel with
  visibly fewer conveniences. Two engines, one look, comparable capability.
  Reimplementing a facet control for Bluesky's own fields is the correct cost.

- **Bridge matches are not all the same thing.**

  > "Matching bridgy may not mean the same as others because bridgy is a mirror
  > account (dupes, who wants them?!) but a linked account where the person
  > posts different content is useful (esp if the other one is dead, no longer
  > used)."

  So Sprint 6 classifies matches by *kind*, not just confidence. See below.

## Sprint 6's match taxonomy, decided up front

Because it changes the data model, not just the ranking:

| Kind | Detection | What the user wants |
|---|---|---|
| **Mirror** | `acct` ends in `.brid.gy` | **Usually nothing.** It is the same posts twice. Offer to *hide* the bridged copy, not to follow it. |
| **Linked** | bio/field contains a `bsky.app/profile/…` URL or a `did:` | **The valuable one.** Same human, different content on each network. Follow both. |
| **Probable** | handle or custom domain matches | Follow with a confidence indicator. |
| **Possible** | display-name fuzzy match | Show last, clearly hedged, never bulk-followable. |

The "especially if the other one is dead" case is the killer feature and it is
cheap: the app already computes dormancy for the effective-audience scan
(`audience-scan.ts`, `effective-audience.ts`). A **Linked** match whose Mastodon
side is dormant and whose Bluesky side is active is the single most useful row
this feature can produce, and it should sort to the top.

## What is deliberately not in this roadmap

- **atproto OAuth.** App passwords stay the login mechanism. Real OAuth needs
  hosted client metadata plus DPoP; it is a later, separable sprint and does not
  block anything here.
- **Custom PDS at login.** `BSKY_SERVICE` stays `https://bsky.social`. Sprint 2
  notes where the seam goes but does not open it.
- **Multiple Bluesky accounts in one browser.** The kind model permits it; no
  sprint here implements the switcher work.
- **Bluesky-primary posting changes.** Compose already routes by provider.
- **Cross-posting one compose to both networks.** Still a stretch goal, still out.
- **Making Bluesky the default for existing Mastodon users.** Never. The app
  stays Mastodon-first for anyone who arrived that way.

## Testing posture

`ui-test-runner`: specs run only via `npm run test:ci`. The manifest guard
(`test-manifest-guard`) exits 1 on renamed or deleted tests even when everything
passes — rerun with `-- --update` when a sprint legitimately moves a spec.

Every sprint carries the same regression clause: **an existing mastodon-primary
session and an existing anonymous session must both behave byte-identically.**
Sprint 1 is where that is cheapest to verify and hardest to get right.
