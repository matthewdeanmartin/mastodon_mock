# Bluesky-first — Sprint 4: the Mastodon connector

Status: **COMPLETE (2026-08-12)** — amended before build, decisions 3 and 4 changed

> **The connector is opt-in, not silent.** Decision 3 below ("it just works,
> silently") is **reversed**: a bsky-primary account starts with the connector
> **absent**, and is *offered* Mastodon where it is relevant. The user's
> reasoning — a silent connector spends rail space, nav entries and the search
> default on a network the visitor never asked for, which is a cost they did not
> opt into. Both credential levels (anonymous and signed-in) are opt-in, and
> anonymous is a real destination rather than a waiting room.
>
> Full reasoning in [bsky-first-0-overview.md](bsky-first-0-overview.md#reversal-the-mastodon-connector-is-opt-in-user-2026-08-12).
> Decision 4 (Home stays Bluesky-only while anonymous) survives unchanged and
> becomes easier to hold. Exit criterion 2 is replaced: a fresh bsky-primary
> login now has **no Mastodon anything** until it opts in.

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-3-bsky-login.md](bsky-first-3-bsky-login.md)

## Goal

Give a Bluesky-primary account a **Mastodon connector**: a slot that starts
**empty**, can be opted into as an anonymous reader of `mastodon.social`, can be
pointed at a different server, and can be upgraded to a real signed-in Mastodon
account.

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

Three states in one slot, not two features — and after the reversal the default
occupant is **nobody**:

```
Mastodon connector
├─ absent                          ← default. No rails, no nav, no requests.
├─ anonymous @ mastodon.social     ← opted in, one click, no credentials
├─ anonymous @ <other server>      ← "change server"
└─ signed in @ <server>            ← "sign in", full read/write
```

The roadmap's own words (2026-08-11): the slot must be *"a real connector from
day one, with anonymous as its default occupant, not a hardcoded anonymous
special case."* The reversal keeps the first half and drops the second — it is
still a real connector rather than a special case, but `absent` is what occupies
it until the user says otherwise.

`absent` is modelled as a **state**, not as `null`. "There is no connector" and
"the connector is anonymous" produce very different chrome, and a nullable type
invites reading the second as a fallback for the first — which is exactly the
silent default the reversal removed.

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

**3. ~~It just works, silently.~~ It is opted into, from Settings.** *(Reversed
2026-08-12, before any code was written.)* A bsky-primary account starts with no
Mastodon anything — no rail widgets, no nav entries, no search default, and no
requests. Settings → Connections → Mastodon is where it is turned on, and where
the truth lives afterwards: *"Reading mastodon.social anonymously"* with
**Change server**, **Sign in** and **Disconnect**.

Opting in without credentials lands on `mastodon.social` immediately rather than
asking which server first (user, 2026-08-12): one click to a working Explore,
with "change server" available afterwards for the people who care. The contextual
offers the amendment describes — an empty Explore, a search with no Mastodon
results — get the predicate they need from `MastodonConnector.optedIn()`, but no
UI this sprint. **Settings is the only opt-in surface built here.**

**4. Home stays Bluesky-only while the connector is anonymous** — and, trivially,
while it is absent. An anonymous
Mastodon connection has no follows, so its "home" is a public firehose —
strangers mixed into a timeline that otherwise contains only people the user
chose. Explore, trends and tags: yes. Home: no. **Once the connector is signed
in, Home merges** — that is the payoff for upgrading, and it makes the upgrade
mean something.

## Planned changes

### 1. `providers/mastodon/mastodon-connector.ts` — the slot

A small service owning the connector's state, scoped under the active identity:

**As built:**

```ts
type MastodonConnectorState =
  | { state: 'absent' }                             // default for bsky-primary
  | { state: 'anonymous'; server: string }
  | { state: 'signed-in'; server: string; account: Account | null };
```

- Stored at `scopedKey('mockingbird_mastodon_connector')` with the usual
  profile/secret split — the token is `secret` at
  `mockingbird_mastodon_connector_token`, the rest `private`. Both registered in
  `storage-registry.ts` (the spec fails the build on an unregistered key).
- Default when absent: **absent**. An untouched connector writes nothing at all,
  which is the storage-level expression of the reversal.
- The token is deliberately *not* in the type. It lives behind `token()`, so a
  state object can be logged or compared without carrying a credential.
- `enableAnonymous(server?)`, `setServer()`, `signIn(token, server, account)`,
  `signOut()` (back to anonymous, not to absent), `disable()` (back to absent).
- A `signed-in` record whose token has gone missing loads as `anonymous` rather
  than being discarded: losing the credential should cost the credential, not the
  opt-in.
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
  Bluesky-primary session. ~~**Verify how the interceptor reads the token before
  designing this**~~ — **verified: it is the small change.**

**What the read found.** `auth.interceptor.ts` reads `inject(Auth).token()` and
nothing else — it never asks what *kind* of account is behind the token. So the
connector rides through the existing signal and every Mastodon call site
authenticates with **zero interceptor changes**. `Auth.connectMastodon(token)`
sets that one signal and deliberately writes nothing else.

**The trap this exposed, and the fix.** `setToken()` mirrors the token to
`TOKEN_KEY`, and the obvious move is to do the same here. It would have been a
real account-corruption path. `storedKind()` falls back to *"a token exists,
therefore mastodon-primary"* when the mode key is missing, and a `bluesky` mode
key is **discarded as stale** when the identity behind it is gone (a settings
import carrying the profile but not the JWTs, a half-finished unlink). Combine
the two and a bsky-primary user with a connector reloads as *mastodon-primary,
signed in as the connector's account* — a different person, silently. So:

- the connector token is **never** mirrored to `TOKEN_KEY`; it lives in the
  connector's own scoped storage and is restored into `Auth.token()` on load;
- `logout()` and `logoutAll()` clear it alongside the Bluesky identity, so a
  connector can never outlive the identity it hangs off.

`account-scope.ts` was checked for the same hazard and is already safe: its
`bluesky` branch returns before it ever reads `TOKEN_KEY`, so a connector token
cannot repoint the storage namespace.

### 3. The aggregator learns the third state

Sprint 3 set `mastodonExhausted = isAnonymous || isBlueskyPrimary`. Now:

- Bluesky-primary + connector **absent** → excluded. Nothing was opted into.
- Bluesky-primary + connector **anonymous** → Mastodon **still excluded from
  Home** (decision 4). Explore/trends/tags are unaffected: they never went
  through the aggregator.
- Bluesky-primary + connector **signed in** → Mastodon **included**, merged.

One subtlety worth recording: the aggregator's *safety net* — the branch that
re-enables Mastodon when every source is hidden — excluded Bluesky-primary
accounts unconditionally, and had to learn the same distinction. A bsky-primary
reader with a signed-in connector genuinely does have a usable Mastodon token, so
the net should catch them like anyone else; without the change they were the one
account kind that could filter itself into a permanently empty Home with no way
back.

### 4. The upgrade flow

**As built: a section of the connector's own settings page**, not a separate page
or dialog — and **not** a reuse of `pages/login/`, which the user predicted
correctly and the read confirmed (26KB bound to its own tabs, OAuth callback,
registration and mock tooling). `app-server-discovery` is reused as-is for
"change server"; it is already standalone and emits a `selected` output.

**Token paste only this sprint. OAuth deferred** — the legitimate fallback the
sprint allowed for. The existing flow registers `<base href>login` as its
`redirect_uri` and returns to a page that owns `handleOAuthCallback` (see the
`oauth-redirect-uri-is-login` memory); routing the connector through it needs a
marker in the stored OAuth record and a second consumer of that callback, which
is a change to a load-bearing route that deserves its own sprint rather than
riding along in this one.

The token is **verified before it is stored**: `connectMastodon()` makes it live,
`verifyCredentials()` proves it, and a failure rolls it straight back out. Storing
an unverified credential would leave the connector claiming `signed-in` while
401ing on every call — and Home would merge a source that cannot answer.

**Decision 1's two-way question is not built**, because after the reversal
nothing reaches it: the only sign-in path is the connector's own page, where the
user has already said "this is a connector" by being there. The *"keep it
separate"* outcome remains available where it always was — the normal Mastodon
login — and the machinery that makes them distinguishable (a connector writes no
session row) is built and spec'd. Raising the question belongs with the
contextual offers, which are deferred with them.

### 5. Settings → Connections → Mastodon

Where the truth lives, per decision 3 — and after the reversal, also where it is
turned **on**. Current state, opt in, change server, sign in, sign out,
disconnect. Mirrors the existing Bluesky connector page, including its
`connection-page.css` and the catalog entry / feature-flag pair.

The catalog needed one thing no other connector has: a connector that is **not
applicable** rather than merely unconfigured. Under a mastodon-primary account
Mastodon is the identity and there is no slot to fill; under Anonymous the
browser-local persona already reads a server of its own. Both cases reuse the
existing `unavailableReason` mechanism — the card greys with the reason rather
than vanishing, per that field's own note that a connector which silently
disappears is a support question. The page repeats the check, because a deep link
reaches it without passing the catalog.

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

All met unless noted.

1. ✅ `npm run test:ci` green (4003/4003); manifest clean.
2. ✅ *(replaced by the amendment)* A **fresh Bluesky-primary login** has **no
   Mastodon anything** — no connector, no rail widgets, no requests — until it
   opts in. Spec'd as `starts absent` plus `writes nothing to storage until it is
   opted into`.
3. ✅ Home shows **only Bluesky** while the connector is absent or anonymous.
4. ✅ Changing the connector's server repoints `Server` and survives a reload;
   spec'd as `survives a reload` and the scoping test.
5. ✅ Signing the connector in leaves `kind() === 'bluesky'`, adds **no** row to
   the switcher, and merges Mastodon into Home. Three separate specs — this is
   the sprint's central hazard.
6. ⏸️ **Deferred with the two-way question** (see §4). The *machinery* is built
   and spec'd — a connector writes no session row, so the two outcomes stay
   distinguishable — but nothing prompts for the choice, because after the
   reversal no path reaches it.
7. ✅ Signing the connector out returns it to anonymous, not to absent.
8. ✅ Both keys registered in `storage-registry.ts`: server `private`, token
   `secret`. The registry spec enforces that a `secret` key never exports.
9. ✅ **A mastodon-primary session is byte-identical**, including its `Server` —
   the connector service reports `absent` and every write path is inert for them.
   Spec'd, plus `disconnectMastodon()` explicitly refuses to touch a
   mastodon-primary token.
10. ✅ An anonymous session is byte-identical; spec'd.

### Two hazards found while building, both closed

- **An orphaned connector token could promote itself into the identity.** With
  the Bluesky identity gone but the connector token left behind, `storedKind()`
  would read the bare token as a mastodon-primary account and sign the browser in
  as somebody else. `logout()` / `logoutAll()` now clear it; two specs pin it.
- **The aggregator's all-sources-hidden safety net excluded bsky-primary
  accounts unconditionally**, which would have left a signed-in connector unable
  to recover from a filter that hides everything. Now keyed on whether a usable
  Mastodon token actually exists.

## ~~Open question~~ — answered by the reversal

**Where does the upgrade flow live — a page or a dialog?** → **The connector's
own settings page**, for this sprint.

The dialog recommendation was made to serve triggers *outside* Settings — an
empty Explore, a post you cannot reply to. The user's scope decision (Settings
only, 2026-08-12) removes those triggers from this sprint, so a dialog would be a
container with one caller. It is still the right shape when the contextual offers
land: the sign-in logic lives in `MastodonConnector` + `Auth.connectMastodon()`,
not in the page, so moving the trigger later does not move the flow.

## What the next sprint inherits

- **The predicate.** `MastodonConnector.optedIn()` / `.signedIn()` is what
  Sprint 4b's rails read to decide whether Mastodon widgets render. It is built,
  spec'd, and makes no requests when absent — which is 4b's exit criterion 2.
- **The contextual offers**, deferred by the scope decision: empty Explore, a
  search with no Mastodon results, "you can't act on this". All have their
  predicate now.
- **OAuth for the connector**, deferred (see §4) — needs a marker in the stored
  OAuth record and a second consumer of the `/login` callback.
- **Decision 1's two-way question**, deferred with the offers that would raise it.
