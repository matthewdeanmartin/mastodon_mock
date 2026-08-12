# Bluesky-first — Sprint 1: account kinds

Status: **COMPLETE** (2026-08-12)

## Outcome

Shipped as planned, invisibly. `npm run test:ci` green (28 new tests, manifest
clean), production build clean, and **zero changes under `pages/`** — the
overreach check the sprint set for itself.

- `AccountKind = 'mastodon' | 'bluesky' | 'anonymous'`, with `AccountMode` kept
  as a deprecated alias and `mode` as an alias signal of `kind`, so all ~250
  existing readers compile and behave unchanged.
- The overloaded predicate is split: `lacksMastodonToken` (meaning A),
  `isAnonymousIdentity` (meaning B), `isBlueskyPrimary`. `isAnonymous` is
  untouched and still returns `kind() === 'anonymous'`.
- `_anonymous` and `_<hash(token)>` suffixes are pinned by specs against
  **hardcoded literals** (`_anonymous`, `_6xtdsz`, `_143bfte`) rather than
  recomputed values, so a broken implementation cannot agree with its own test.
- New `_bsky_<hash(did)>` suffix; `scopeSuffixForDid`, `BLUESKY_SCOPE_PREFIX`.
- `providers/bluesky/bluesky-identity-store.ts` holds the unscoped identity
  (profile/secret split), resolving the circular-scope problem. Bare functions,
  no Angular imports — which is what keeps `account-scope.ts` free of a cycle.
- A stale `bluesky` mode key with no identity behind it falls back to signed-out
  in **both** `Auth` and `account-scope.ts`, so the two cannot disagree about
  which account is active.

### One real bug found and fixed

`logout()` had no Bluesky branch, so a Bluesky-primary account fell into the
Mastodon path: it filtered the stable by a null token (removing nothing) and
then **auto-switched into a saved Mastodon account**. No data loss, but the app
would have looked like it *changed accounts* rather than signing out — the exact
disguise that made the original account-loss bug so hard to notice. Fixed with a
dedicated branch, and pinned by a spec named after the hazard.

`logoutAll()` also now clears the Bluesky identity; leaving it behind would have
made the one exit that promises to take everything quietly not.

### Deferred, as recommended

The left-rail question — whether a Bluesky card reads as "your identity" or "a
connector" — was left alone. It is invisible until a Bluesky-primary account can
be created, and the wording belongs with the login flow that makes it reachable.

### Handoff

[bsky-first-1-handoff.md](bsky-first-1-handoff.md) — the full `isAnonymous`
migration inventory, classified A / B / needs-judgement, so the next sprint
triages a list instead of rediscovering the problem.

---

Status when written: PROPOSED (2026-08-11)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)

## Goal

Teach `Auth` and `account-scope.ts` that an account has a **kind**, and that
`bluesky` is one of them — with **no user-visible change whatsoever**.

At the end of this sprint a bsky-primary account can be constructed, persisted,
activated, scoped, switched away from and switched back to. Nothing in the UI
creates one yet. That is Sprint 2.

**If this sprint is visible to a user, it is wrong.** The user asked to move
slow and get it right; this is the sprint where that discipline is bought.

## Why this is its own sprint

Two numbers, measured 2026-08-11:

- **249 occurrences of `isAnonymous` / `auth.mode()` / `AccountMode` across 89
  files.**
- **132 occurrences of `scopedKey` / `accountScopeSuffix` across 36 files.**

Any sprint that both changes this model *and* ships a feature will be impossible
to review, and a regression will land on the mastodon-primary users who are the
current entire user base. So the model change ships alone, additively, with the
old API intact and passing its existing specs.

## The central discovery: `isAnonymous` is overloaded

This is the finding that shapes the whole sprint. `auth.isAnonymous` is used to
mean **two different things**, and a bsky-primary account needs opposite answers
to them. From `pages/home/home.ts` alone:

```ts
// MEANING A — "there is no Mastodon token, so don't make authenticated calls"
this.prefs.autoRefreshTimeline() && !this.auth.isAnonymous && ...   // :399  streaming
!this.nudgeDismissed() && !this.auth.isAnonymous && ...             // :337  server nudge

// MEANING B — "read and write the browser-local anonymous stores"
if (this.auth.isAnonymous) { ... }                                  // :499  anonymous home feed
const merged = this.auth.isAnonymous ? ...                          // :706  anonymous merge
private cacheAnonymousHome() { if (this.auth.isAnonymous) ...  }    // :800  anonymous cache
```

A bsky-primary account needs **A = true** (no Mastodon token exists, so no
streaming, no `verify_credentials`, no server nudge) and **B = false** (its home
feed comes from Bluesky, not from the anonymous local corpus).

`isAnonymous` cannot answer both. So Sprint 1's real work is not adding a third
enum value — it is **splitting the question**.

### The split

Three new predicates on `Auth`, alongside the existing ones:

```ts
/** The kind of the active account. Null when signed out. */
readonly kind: Signal<AccountKind | null>;

/** MEANING A. True when no Mastodon bearer token is available. */
get lacksMastodonToken(): boolean;          // anonymous | bluesky | signed out

/** MEANING B. True only for the browser-local Anonymous identity. */
get isAnonymousIdentity(): boolean;         // anonymous only

/** True when the primary network is Bluesky. */
get isBlueskyPrimary(): boolean;            // bluesky only
```

`isAnonymous` **stays**, unchanged, returning `kind() === 'anonymous'` — which is
exactly what it returns today. Every one of the 249 call sites keeps compiling
and keeps its current behaviour. Migrating the meaning-A sites to
`lacksMastodonToken` happens in Sprint 2, **per page, as each page is taught
about bsky-primary**, so each migration is reviewable against a page that
actually exercises it.

This is the crux of the design. Do not try to migrate 89 files in this sprint.

## Locked product decisions

- Account kinds are `mastodon | bluesky | anonymous`. `AccountMode` is retained
  as a deprecated alias of `AccountKind` so no import breaks.
- `_anonymous` and `_<fnv1a(token)>` scope suffixes are **byte-identical** to
  today. No migration, no data movement.
- The new suffix is `_bsky_<fnv1a(did)>`.
- A bsky-primary account's **own** Bluesky session is an identity, stored in an
  unscoped stable. A Bluesky **connector** under a Mastodon-primary account keeps
  its existing scoped key. Same `BlueskySession` class, two storage strategies.
- Persisted `ACCOUNT_MODE_KEY` keeps accepting the strings it writes today; the
  new value is the literal `'bluesky'`.
- Nothing in this sprint creates, offers or advertises a bsky-primary account.

## Planned changes

### 1. `auth.ts` — kinds

- `export type AccountKind = 'mastodon' | 'bluesky' | 'anonymous';`
- `export type AccountMode = AccountKind;` marked `@deprecated`.
- `readonly kind` signal, initialised from `ACCOUNT_MODE_KEY` — with `'bluesky'`
  only honoured when a bsky-primary identity is actually present in storage, so
  a stale mode key cannot strand the app in an identity that does not exist.
- `mode` stays as a `computed` alias of `kind` so existing readers are untouched.
- `lacksMastodonToken`, `isAnonymousIdentity`, `isBlueskyPrimary` as above.
- `isAuthenticated` becomes `kind() !== null` — same expression, wider enum, so
  `authGuard` admits a bsky-primary account with no change to the guard.
- `enterBluesky(did: string)` / the bsky arm of `switchAccount`, mirroring
  `enterAnonymous`. Deliberately **not** wired to any UI.
- `AccountChoice.kind` widens to `AccountKind`; `otherSessions` gains the
  bsky-primary row when one exists and is not active.

### 2. `account-scope.ts` — the third suffix

- `accountScopeSuffix()` reads the mode key and branches to `_bsky_<hash(did)>`
  when it is `'bluesky'`, reading the DID from the bsky-primary identity store.
- `scopeSuffixForDid(did)`, the sibling of the existing `scopeSuffixForToken` —
  needed by Settings → Signed-in accounts to find and delete another account's
  local data.
- `export const BLUESKY_SCOPE_PREFIX = '_bsky_';`
- The existing two branches are not touched. The spec asserts this literally.

### 3. `providers/bluesky/bluesky-session.ts` — identity vs connector

- Extract the storage-key pair behind a small strategy so the class can serve
  both roles. Connector: `scopedKey(...)` as today. Identity: fixed unscoped
  keys, profile/secret split in the same shape `auth.ts` already uses for
  Mastodon sessions.
- **`BSKY_SERVICE` stays `https://bsky.social`.** The custom-PDS seam is noted
  here and opened by nobody in this roadmap.
- No change to `login`, `refresh`, `unlink` semantics.

### 4. `storage-registry.ts`

Register the new keys so Settings → Storage and the export/import path account
for them. The identity's credentials must be marked `secret` — a settings export
must carry which Bluesky account is primary and never its JWTs, exactly as it
already treats Mastodon tokens.

### 5. `session-diagnostics.ts`

`enter-bluesky` / `switch-to-bluesky` transitions logged with the same
before/after session counts as the existing transitions. Per the
`session-diagnostics-logging` memory the console is the only forensics available,
and the account-loss bug that motivated `leaveActive()` is exactly the class of
bug this sprint could reintroduce.

## Explicit non-goals

- Migrating any of the 249 `isAnonymous` sites. Sprint 2+, per page.
- Any login-page change. Sprint 2.
- Any left-rail / switcher UI change. The bsky-primary row is *computed* by
  `otherSessions` but no user can produce one yet.
- Custom PDS, atproto OAuth, multiple Bluesky accounts.
- Touching `AnonymousAccount`'s stored shape.

## Risks

| Risk | Mitigation |
|---|---|
| **Account loss.** The `leaveActive` docstring records a field report where signing out silently destroyed a saved account. Widening the identity model is how that recurs. | `leaveActive`/`logout`/`removeSession` get bsky-primary cases written *with* their specs, not after. The `logout-vs-leave` memory applies unchanged: `logout()` forgets, `leaveActive()` does not. |
| **Scope suffix drift** — an off-by-one in the anonymous or mastodon branch silently repoints every scoped key and the user's RSS feeds, saved searches and Bluesky link all vanish. | A spec that asserts both existing suffixes literally, character for character, against hardcoded expected strings. Not derived — hardcoded. |
| **Stale `ACCOUNT_MODE_KEY = 'bluesky'`** with no identity in storage strands the app. | `kind` initialisation validates presence and falls back to signed-out. Spec'd. |
| **The circular scope** (bsky identity scoped by its own DID). | Resolved by the identity/connector split above; a spec asserts the identity store is reachable with no active account. |

## Exit criteria

1. `npm run test:ci` green. Manifest guard clean (`-- --update` if specs moved).
2. **An existing mastodon-primary session behaves byte-identically.** Verified by
   the literal-suffix spec plus a manual pass: log in, home, search, settings.
3. **An existing anonymous session behaves byte-identically.** Same.
4. A bsky-primary account can be constructed in a spec, activated, scoped
   (`_bsky_<hash>`), switched away from to a Mastodon session and switched back,
   with its Bluesky session intact and the Mastodon session untouched.
5. `lacksMastodonToken` / `isAnonymousIdentity` / `isBlueskyPrimary` return the
   correct triple for all four states (mastodon, bluesky, anonymous, signed out).
6. `logout`, `leaveActive`, `removeSession`, `logoutAll` each spec'd against a
   bsky-primary active account, asserting **no other saved account is lost**.
7. `git diff --stat` shows no changes under `pages/` except imports. If a page
   changed, the sprint overreached.
8. Sprint 2 has a written handoff before this closes — specifically: the list of
   meaning-A `isAnonymous` sites that Sprint 2 must migrate, enumerated from the
   89 files, so that work is inventory rather than discovery.

## Open question for the user

**Does a bsky-primary account appear in the left-rail profile stack and the
account switcher the moment it exists, or only once Sprint 2 can create one?**

`rail-profiles.ts` today pushes a Bluesky card for any linked session — under
the new model that card is either "your identity" or "a connector", and it
should probably read differently in each case. Sprint 1 can leave the existing
behaviour alone (recommended, it is invisible either way since no bsky-primary
account can exist yet) or fix the wording now. Recommendation: **leave it**, and
let Sprint 2 change it alongside the login flow that makes it reachable.
