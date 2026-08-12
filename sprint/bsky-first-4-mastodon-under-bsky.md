# Bluesky-first — Sprint 4: the Mastodon connector

Status: PROPOSED (2026-08-12)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-3-bsky-login.md](bsky-first-3-bsky-login.md)

## Goal

Give a Bluesky-primary account a **Mastodon connector**: a slot that is always
present, defaults to reading `mastodon.social` anonymously, can be pointed at a
different server, and can be upgraded to a real signed-in Mastodon account.

Sprint 3 shipped an app with no Mastodon source at all — Explore, trends and tag
timelines are empty for a Bluesky-primary account. That was deliberate, but it
means the sprint is only half a product until this one lands.

## The model, corrected

My first reading of this sprint was thinner than the user's: I had "turn the
Mastodon source back on, anonymously" — a flag in the aggregator. The user's
model, which is the one the roadmap actually promised, is a **connector with its
own lifecycle**:

> "The mastodon connector would default to being active and being anonymous
> mastodon.social, but can be connected to a different server or logging in."

Three states in one slot, not two features:

```
Mastodon connector
├─ anonymous @ mastodon.social     ← default occupant, no setup
├─ anonymous @ <other server>      ← "change server"
└─ signed in @ <server>            ← "sign in", full read/write
```

The roadmap's own words (2026-08-11): the slot must be *"a real connector from
day one, with anonymous as its default occupant, not a hardcoded anonymous
special case."* That is exactly this.

### On code reuse — the user's steer

> "Yes, this functionality is similar to the anonymous experience, but don't go
> crazy trying to force it all into a single code file. If there is easy code
> reuse, reuse otherwise, be willing to setup a new login cycle, esp if the
> existing code is tightly bound to the UI, which it probably is."

Confirmed by reading. What is reusable and what is not:

| Piece | Reuse? | Why |
|---|---|---|
| `Api` / the whole Mastodon API surface | **Yes, unchanged** | It never branches on `isAnonymous`. It reads `Server.baseUrl()` and the interceptor attaches a token *if one exists*. Anonymous Mastodon reads already work by simply having no token — which is why `/explore` is unguarded today. **This is the big win.** |
| `Session { token, server, account }` | **Yes, the shape** | A connector is exactly this triple. No new type needed. |
| `Server` singleton | **Yes** (user's call, Q2) | See below. |
| `AnonymousAccount` | **No** | It owns a *local persona* — editable display name, avatar, bio. A Bluesky-primary user already has an identity and does not want a second one. Reuse the server plumbing, not the identity. |
| `pages/login/login.ts` (26KB) | **No** | Tightly bound to its own page: tabs, OAuth callback, registration, mock tooling, dev users. The user predicted this correctly. A small dedicated connector login is the right call. |

### Locked product decisions (user, 2026-08-12)

**1. Upgrading asks the user what they meant.** Signing in to Mastodon from a
Bluesky-primary session offers two outcomes:

```
You signed in to fosstodon.org.
  ( ) Add to my Bluesky account   — one merged timeline
  ( ) Keep it separate            — switch between them
```

This is the decision that shapes the sprint, because **both paths need work that
does not exist**:

- *Keep it separate* ≈ today's `Auth.setToken()`, which creates a
  mastodon-primary session. Nearly free.
- *Add to my Bluesky account* needs a **new** path that stores a Mastodon token
  **without touching `kind`**. Today `setToken()` unconditionally sets
  `kind = 'mastodon'` and clears `blueskyDid` — so as the code stands, signing in
  to Mastodon would silently convert the account kind and drop the user out of
  their Bluesky identity. That is the connector, and it is the real work here.

**2. The connector reuses the global `Server` singleton.** `Server.baseUrl()` is
one signal behind one localStorage key, read by the entire Mastodon API layer —
so "the connector points at fosstodon.org" is currently the same fact as "the app
points at fosstodon.org". Under a Bluesky-primary account nothing else competes
for it, so this works and costs almost nothing. **Limitation to write down:** it
forecloses two simultaneous Mastodon connectors, which is not a goal.

**3. It just works, silently.** No banner, no opt-in card, no nag. Explore and
trends populate on first load. Settings is where the truth lives: *"Reading
mastodon.social anonymously"* with **Change server** and **Sign in**.

**4. Home stays Bluesky-only while the connector is anonymous.** An anonymous
Mastodon connection has no follows, so its "home" is a public firehose —
strangers mixed into a timeline that otherwise contains only people the user
chose. Explore, trends and tags: yes. Home: no. **Once the connector is signed
in, Home merges** — that is the payoff for upgrading, and it makes the upgrade
mean something.

## Planned changes

### 1. `providers/mastodon/mastodon-connector.ts` — the slot

A small service owning the connector's state, scoped under the active identity:

```ts
type MastodonConnector =
  | { state: 'anonymous'; server: string }          // default: mastodon.social
  | { state: 'signed-in'; server: string; token: string; account: Account | null };
```

- Stored at `scopedKey('mockingbird_mastodon_connector')` with the usual
  profile/secret split — the token is `secret`, the rest `private`. Register both
  in `storage-registry.ts` (the spec fails the build on an unregistered key).
- Default when absent: `{ state: 'anonymous', server: 'https://mastodon.social' }`.
  Materialised lazily; an untouched connector writes nothing.
- `setServer()`, `signIn(token, server, account)`, `signOut()` (back to anonymous,
  not to absent), `disable()` / `enable()`.
- Only meaningful for a Bluesky-primary account this sprint. Under a
  mastodon-primary account Mastodon is the identity, not a connector; the service
  reports "not applicable" and nothing changes for those users.

### 2. `Auth` — a token that does not claim the identity

The one genuinely delicate change. Add a path that records a Mastodon token as a
*connector* rather than as the active identity:

- `setToken()` keeps its current behaviour exactly (mastodon-primary login).
- New: connecting Mastodon under a Bluesky identity must **not** write
  `ACCOUNT_MODE_KEY`, must **not** set `kind`, must **not** clear `blueskyDid`,
  and must **not** add a row to the Mastodon session stable — otherwise the
  account appears in the switcher as a separate login, which is the *other*
  choice the user explicitly asked to distinguish.
- The interceptor must attach the connector's token for Mastodon calls made by a
  Bluesky-primary session. **Verify how the interceptor reads the token before
  designing this** — it is the difference between a small change and a large one.

### 3. The aggregator learns the third state

Sprint 3 set `mastodonExhausted = isAnonymous || isBlueskyPrimary`. Now:

- Bluesky-primary + connector anonymous → Mastodon **still excluded from Home**
  (decision 4). Explore/trends/tags are unaffected: they never went through the
  aggregator.
- Bluesky-primary + connector signed in → Mastodon **included**, merged.

### 4. The upgrade flow

A small dedicated page or dialog — **not** a reuse of `pages/login/`. Server
field (reusing `app-server-discovery`, which is already a standalone component),
then OAuth or token. On success, the two-way question from decision 1.

OAuth is the awkward part: the existing flow registers `<base href>login` as its
`redirect_uri` and comes back to a page that owns `handleOAuthCallback` (see the
`oauth-redirect-uri-is-login` memory). Options, to be settled while building:
route the connector flow through the same callback with a marker in the stored
OAuth record, or start with token-paste only and add OAuth in a follow-up. The
former is better; the latter is a legitimate fallback if the callback proves
tangled.

### 5. Settings → Connections → Mastodon

Where the truth lives, per decision 3. Current state, change server, sign in,
sign out, disable. Mirrors the existing Bluesky connector page.

## Explicit non-goals

- Two Mastodon connectors at once (foreclosed by decision 2, deliberately).
- Any change for mastodon-primary users. Regression clause as always.
- Merging anonymous-Mastodon *local* state (follows, tags) into the connector —
  those belong to the Anonymous identity and stay there.
- A local persona for the connector. It is a connection, not an identity.
- Bluesky-under-Mastodon changes. That connector already works.

## Risks

| Risk | Mitigation |
|---|---|
| **Signing in silently converts the account kind.** Live hazard today: `setToken()` sets `kind='mastodon'` and clears `blueskyDid`. | The connector path never calls `setToken()`. Spec it directly: connect Mastodon under a Bluesky identity, assert `kind()` is still `'bluesky'` and the DID is intact. |
| **The switcher shows a phantom account.** Writing a session row for a connector makes it look like a separate login — the exact distinction decision 1 asks the user to make. | The connector is not a session row. Spec `otherSessions` after connecting. |
| **The interceptor attaches the wrong token**, or none. | Read it first; spec a Mastodon call under a signed-in connector carrying the token, and under an anonymous one carrying none. |
| **The global `Server` gets repointed under a mastodon-primary user** by connector code that should be inert for them. | The service reports "not applicable" outside Bluesky-primary; spec that a mastodon-primary session's `Server` is untouched. |
| **Home fills with strangers** if the anonymous connector is wired into the aggregator by accident. | Decision 4, spec'd both ways: anonymous → excluded, signed-in → merged. |

## Exit criteria

1. `npm run test:ci` green; manifest clean.
2. A **fresh Bluesky-primary login** has working Explore, trends and tag
   timelines with **no setup and no prompt**.
3. Home shows **only Bluesky** while the connector is anonymous.
4. Changing the connector's server changes what Explore shows, and survives a
   reload.
5. Signing the connector in and choosing **"add to my Bluesky account"** leaves
   `kind() === 'bluesky'`, adds **no** row to the switcher, and merges Mastodon
   into Home.
6. Signing in and choosing **"keep it separate"** produces a normal
   mastodon-primary account in the switcher, with the Bluesky identity intact and
   switchable.
7. Signing the connector out returns it to anonymous — not to absent, not to
   signed-out-of-everything.
8. A settings export carries the connector's server and **never** its token.
9. **A mastodon-primary session is byte-identical**, including its `Server`.
10. An anonymous session is byte-identical.

## Open question for the user

**Where does the upgrade flow live — a page or a dialog?**

Settings → Connections → Mastodon → Sign in is the consistent home (it is where
the Bluesky connector's login lives). But the most likely moment someone wants
this is while looking at an empty Explore or a Mastodon post they cannot reply
to — and sending them into Settings from there loses the thread. A dialog can be
raised from either place. Recommendation: **dialog**, reachable from Settings and
from the "you can't act on this" affordances, so the trigger can move later
without moving the flow.
