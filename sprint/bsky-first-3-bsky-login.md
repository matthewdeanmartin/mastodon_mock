# Bluesky-first — Sprint 3: log in with Bluesky

Status: **COMPLETE** (2026-08-12)

## Outcome

**A fresh browser, a Bluesky handle and an app password now produce a working
app.** Verified end to end against real Bluesky (`mistersql.bsky.social`), not
just in specs: 10–12 real posts on Home, rail reading 🦋 Bluesky active with real
counts (1,493 / 946 / 551), session surviving reload.

`npm run test:ci` green — 3946 tests, 26 added, manifest clean. Build clean
(+1.1 kB initial, all lazy-loaded).

### The one-line seam that made it work

Every Bluesky consumer in the app — `BlueskyApi`, `BlueskyChatApi`,
`BlueskyProvider`, `BlueskyReply` — injects the `BlueskySession` singleton and
reads `session()`. So rather than threading an identity concept through the
provider layer, `BlueskySession` now picks **which pair of storage keys it holds**
at construction: the unscoped identity keys when the active kind is `bluesky`,
the scoped connector keys otherwise. One decision in one place, and every
consumer lit up unmodified.

`loginAsIdentity()` exists for an ordering reason worth remembering: at the
moment a first-time Bluesky login is submitted the active kind is *not yet*
`bluesky`, so the instance is still holding connector keys. Writing the identity
through them would file it under the previous account's namespace, where the next
boot would never look.

### Five real bugs found, four of them latent in shipped code

1. **Boot self-logout.** `shell.ts` skipped `verify_credentials` only for
   Anonymous, so a Bluesky-primary session hit it with no token and the error
   branch called `exitToLoggedOut()` — signing itself out on *every boot*.
2. **Empty Home, and the reason.** The aggregator queried `/api/v1/timelines/home`
   → 401, and because the round is a `forkJoin`, that one failure took the whole
   round down and **discarded the Bluesky posts that had loaded fine**. This was
   assigned to Sprint 4 in the spec; it was a hard blocker here.
3. **Retention policy would sign the user out.** `credential-lifetime.ts` governs
   *connector* credentials ("I connected GitHub once in 2024"). Applied to the
   account you are signed in *as*, the default 90 days would silently sign you out
   and leave a `bluesky` kind with no identity behind it — the stale-key state
   Sprint 1 built two guards against. Exempted, and note the exemption had to
   cover **both** enforcement points: `enforceLifetime()` *and* `loadSession()` on
   construction. A spec caught that I had only done the first.
4. **Switching to Bluesky did nothing.** `shell.switchTo` reloaded only for
   `kind === 'anonymous'`; a `bluesky` choice fell through to a token comparison
   where both sides were null and returned silently. The revert path had the
   mirror bug: a failed switch *away* would have called `exitToLoggedOut()`.
5. **Rail showed the account twice** — once mislabelled 🐘 MASTODON with zeroed
   counts, once as a connector the user never linked.

### The predicate mistake worth recording

I first used `lacksMastodonToken` at these sites and **51 specs failed**. That
predicate is `kind() !== 'mastodon'`, which is *also true when signed out* — and
most specs never set a token, so the aggregator disabled Mastodon everywhere.

The fix was `isAnonymous || isBlueskyPrimary`, not the broader predicate: a
signed-out session never reaches Home in the real app (the guard redirects), so
treating it as Mastodon-capable is both harmless and what the existing specs
assume. **`lacksMastodonToken` is right for its docstring and wrong for these
call sites** — the handoff's A/B classification needs this third distinction, and
the remaining ~30 meaning-A sites should be migrated with it in mind.

### Also fixed, from the handoff's judgement list

- `thread.ts` — `capabilitiesFor(provider, !isAnonymous)` gave a Bluesky-primary
  reader Reply/Favourite buttons on *Mastodon* posts, wired to an API it has no
  token for. Now a per-provider `canActOn()`.
- `feed-capability.ts` — cache key gained a third value (`anon|bsky|auth`), so a
  Bluesky-primary session's anonymous Mastodon probes cannot contaminate a real
  anonymous session's cache.
- `command-bar.ts` — no 🦣 Fedi chip for a Bluesky-primary account; it toggled a
  source that was never queried.
- `home.ts` — the follow nudge told an account following 946 people that it
  followed 0 (the identity adapter zeroes counts by design), and pointed at a
  Mastodon importer it cannot use. Streaming likewise gated.
- `rail-profiles.ts` — the deferred Sprint 1 question, answered: the active card
  names the network the app is signed in *to*, and the connector card is skipped
  when Bluesky *is* the identity. Also stopped `followedTags()` 401ing.
- `fail-whale.ts:86` — **left alone.** "Only anonymous users can freely change
  instance" is still exactly right.
- `leave-dialog` — third copy variant. The middle option ("delete anonymous
  data") is hidden for a Bluesky-primary identity, because it names data they do
  not have on a button that sounds like it erases the data they do.

### Verified at runtime

| Criterion | Result |
|---|---|
| 2. Two clicks from `/` to signed in | ✔ |
| 3. Home renders a real Bluesky timeline | ✔ 10–12 posts |
| 4. Reload keeps the session | ✔ |
| 6. Handle stored, no JWT in the exportable half, app password nowhere | ✔ |
| 7. Leave dialog, Bluesky copy; "keep everything" keeps the identity | ✔ |
| 8. Mastodon-primary byte-identical | ✔ 🐘 Mastodon active, Fedi chip, 5 posts |
| 10. Self-hosted PDS hint instead of "wrong password" | ✔ |

### On the custom-PDS question

The user asked whether non-`bsky.social` instances exist yet. They do, and the
distinction decided the scope:

- **Every `bsky.social` account already has a PDS that is not `bsky.social`** —
  it is an *entryway*. Our own `bluesky-chat-api.ts` resolves the real host from
  the DID document's `#atproto_pds` via `plc.directory`, because proxied chat
  calls 501 on the entryway. But `createSession` at the entryway works fine for
  these accounts, so the fixed constant is right for nearly everyone.
- **Fully self-hosted PDSes** are real but rare, and for them `createSession` at
  `bsky.social` genuinely fails.

So no host field — it would drag handle→DID→PDS resolution into the headline
sprint for a very small population. But the cheap half shipped: a rejected login
on a non-`bsky.social` domain says *"if you host your own PDS, that isn't
supported yet"* rather than blaming the password. One sentence, and it removes the
only failure on this form that looks like something it isn't.

### Still open

- **Sprint 4 is now load-bearing, not optional.** This app has no Mastodon source
  at all: Explore, trends and tag timelines are empty for a Bluesky-primary
  account. That was the plan, but it means the sprint is only half a product until
  4 lands.
- The **composer** still opens on a Fedi target for a Bluesky-primary account
  (it posts to Bluesky when switched, but the default is wrong).
- Open question 2 from the spec — greyed out vs hidden vs an invitation to attach
  Mastodon — was **not** decided and is Sprint 4's to answer.

---

Status when written: PROPOSED (2026-08-12)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-2-front-door.md](bsky-first-2-front-door.md)

## Goal

**A fresh browser, a Bluesky handle and an app password produce a working app,
with no Mastodon anything.**

This is the headline sprint. Sprints 1 and 2 built the plumbing and the door;
this one turns the door on. At the end of it, `enterBluesky()` — which Sprint 1
deliberately left able to *activate* an identity but not *create* one — has
something to activate.

## What already exists (and what that saves)

Worth stating, because it is most of the sprint's budget:

| Piece | State |
|---|---|
| `AccountKind = 'bluesky'`, `kind` signal, stale-key refusal | Sprint 1 ✔ |
| `_bsky_<hash(did)>` scope suffix | Sprint 1 ✔ |
| `bluesky-identity-store.ts` (unscoped, profile/secret split) | Sprint 1 ✔ |
| `enterBluesky()`, `switchAccount({kind:'bluesky'})`, logout/logoutAll branches | Sprint 1 ✔ |
| Identity keys in `storage-registry.ts` (`secret` + `private`) | Sprint 1 ✔ |
| `/login/bluesky` route + chooser door | Sprint 2 ✔ (stub body) |
| `BlueskySession.login()` — `com.atproto.server.createSession` + `getProfile` | pre-existing ✔ |
| Bluesky content: timelines, threads, posting, search, chat | `bsky_parity_*` ✔ |

So the new code is: a form, an identity-aware persistence path, and the ~11
judgement calls from
[bsky-first-1-handoff.md](bsky-first-1-handoff.md) that a Bluesky-primary
session actually reaches on boot.

## Locked product decisions (user, 2026-08-12)

### Logout offers the leave-dialog choice

Not a silent forget. A Bluesky-primary user leaving gets the same three-way
dialog Mastodon and Anonymous users get — leave and keep everything (default),
delete my Bluesky data, remove everything — with an export offered first.

This is consistent, and it is nearly free: `LeaveDialog` uses `isAnonymous` only
to pick *copy* (`who`), and both destructive paths already run through
`SessionTeardown`, which is registry-driven. Because Sprint 1 registered the two
identity keys, `clearAllData()` already sweeps them and
`clearAnonymousData()` already leaves them alone. **The work is copy plus a third
variant, not new teardown logic.** Verify that claim with a spec rather than
trusting it.

### The form lives at `/login/bluesky` and reuses `BlueskySession.login()`

One login code path. `createSession` + `getProfile` already work and are already
spec'd; duplicating them into a parallel service would give two things to keep in
sync for no gain. What differs is only **where the result is written**: the
identity keys (unscoped) instead of the scoped connector keys.

### `bsky.social` only — but say so when it fails

`BSKY_SERVICE` stays `https://bsky.social`. No custom-PDS field.

The user asked whether non-`bsky.social` instances exist yet. They do, and the
distinction matters:

- **Every `bsky.social` account already has a PDS that is not `bsky.social`.**
  `bsky.social` is an *entryway*; the real data host is elsewhere. Our own
  `bluesky-chat-api.ts` resolves it from the DID document's `#atproto_pds` via
  `plc.directory`, because proxied chat calls 501 on the entryway (see the
  `bsky-chat-pds` memory). `createSession` against the entryway works fine for
  these accounts, so the fixed constant is right for nearly everyone.
- **Fully self-hosted PDSes** — someone running their own server rather than
  using Bluesky's — are real but rare, and for them `createSession` at
  `bsky.social` genuinely fails.

A host field would drag handle→DID→PDS resolution and its own error states into
the sprint that has to work perfectly, for a very small population. So: not now.

**But** add the cheap half. If `createSession` fails and the handle's domain is
not `bsky.social`, say *"If you host your own PDS, signing in that way isn't
supported yet"* rather than *"wrong handle or password"*. One sentence, and it
removes the single most confusing failure this form can produce. The seam for a
real host field goes in the same place, commented.

## Planned changes

### 1. `providers/bluesky/bluesky-identity.ts` — persistence, not a second login

A thin store over the Sprint 1 keys: `save(session)`, `load()`, `clear()`,
`refresh()`. It does **not** re-implement `createSession`; the login page calls
`BlueskySession.login()` for the network round trip and hands the result here.

The one subtlety worth writing down: `BlueskySession` resolves its storage keys
**at construction** from `scopedKey(...)`, and for a Bluesky-primary account the
scope suffix derives from the DID that does not exist yet at form-submit time.
So the connector instance must not be the thing that persists an identity login.
Keep the network call, redirect the write.

### 2. `pages/login-bluesky/` — the real form

- Handle and app password. Nothing else above the fold.
- Prominent, non-negotiable explanation of **app passwords**: what they are,
  that they are revocable, that this is never the real account password, and a
  direct link to `bsky.app` → Settings → App Passwords.
- Error states: bad credentials, rate limited, network/CORS failure, and the
  self-hosted-PDS hint above.
- On success: write the identity, `auth.enterBluesky()`, land on `/home` — the
  same destination the anonymous path and the Mastodon path reach.

### 3. Boot: the bug that will otherwise log the user out every time

`shell.ts:252` returns early only for `isAnonymous`. A Bluesky-primary account
falls through to `verifyCredentials()`, which cannot succeed with no Mastodon
token — and the error branch calls `exitToLoggedOut()`. **A Bluesky-primary
session as built today logs itself out on every boot.** This is meaning A
(`lacksMastodonToken`), and it is the first thing to fix.

### 4. The rest of the handoff's judgement calls that boot actually reaches

From [bsky-first-1-handoff.md](bsky-first-1-handoff.md), the subset a
Bluesky-primary session hits before it can be called working:

| Site | Decision |
|---|---|
| `shell.ts:252` | `lacksMastodonToken` — skip verify (above) |
| `shell.ts:310` | `previousWasAnonymous` drives reload-on-switch; a Bluesky switch needs the same reload |
| `shell.html:232,238` | Third label. "Log out" is right for a real identity, not "Exit anonymous" |
| `leave-dialog.ts:50` | Third copy variant, per the decision above |
| `feed-capability.ts:220` | Cache key `host\|anon\|auth` needs a third value or a Bluesky-primary session's anonymous Mastodon probes collide with a real anonymous session's cache |
| `thread.ts:129` | `capabilitiesFor(provider, !isAnonymous)` — for a Bluesky post under a Bluesky account the answer is **yes, can act** |
| `command-bar.ts:55,60` | Don't show "Bsky" as a *foreign* provider chip when it is the primary network |
| `rail-profiles.ts:58–107` | The card is now "your identity", not "a connector" — the question Sprint 1 deferred |
| `fail-whale.ts:86` | Error copy assumes anonymous-or-Mastodon |

`feed-aggregator.ts:128,141` (`mastodonExhausted`) is **Sprint 4's**, not this
one — there is no Mastodon source under a Bluesky account until Sprint 4 attaches
one.

### 5. Home must render

The acceptance bar is not "the form submits". It is that `/home` shows a Bluesky
timeline for a Bluesky-primary account. `FeedAggregator` already reaches the
Bluesky provider; what is unproven is that it does so when Bluesky is the
*identity* rather than a connector, since the provider reads
`BlueskySession.session()` and that instance is keyed to the scoped connector
keys. **This is the most likely place for the sprint to discover real work.**
Verify at runtime early, not at the end.

## Explicit non-goals

- **Mastodon under Bluesky.** Sprint 4. This sprint's app has no Mastodon source
  at all, and Explore/trends will be empty or hidden. That is expected and is
  exactly why Sprint 4 exists.
- Custom PDS, atproto OAuth, DPoP.
- Multiple Bluesky accounts in one browser.
- Bluesky search parity (Sprint 5), anonymous Bluesky (Sprint 6).
- Migrating the remaining ~85 mechanical `isAnonymous` sites. Only the ones a
  Bluesky-primary boot reaches.

## Risks

| Risk | Mitigation |
|---|---|
| **The app password lands in the wrong storage half** — a JWT or password in an exportable key is the worst bug available here. | `storage-registry.spec.ts` already fails the build on an unregistered `setItem`. Add a spec asserting a settings export carries the handle and **never** the JWTs, and that the password is never written at all. |
| **Boot loop / self-logout.** §3 above is a live bug today. | Fix first, spec it, and verify a reload keeps the session. |
| **The connector and the identity fight.** Both are `BlueskySession`-shaped; a Mastodon-primary user with a Bluesky connector must be completely unaffected. | The connector keeps its scoped keys and its code path. Spec: a Mastodon-primary session with a Bluesky link, before and after this sprint, sees byte-identical storage. |
| **Home renders empty** because the provider reads the connector instance. | §5 — verify at runtime early. If it needs a seam, that seam is this sprint's real content. |
| **Account loss**, the standing risk of every sprint in this roadmap. | `logout`/`leaveActive`/`removeSession`/`logoutAll` already have Bluesky branches and specs from Sprint 1. Re-run them; add the leave-dialog path. |

## Exit criteria

1. `npm run test:ci` green; manifest clean.
2. **A fresh browser** reaches `/login/bluesky` from `/` in two clicks, signs in
   with a real handle + app password, and lands on `/home`.
3. `/home` **renders a real Bluesky timeline** for that account.
4. A **reload** keeps the user signed in — no boot logout, no re-prompt.
5. The identity survives a switch to a Mastodon account and back, with the
   Mastodon session untouched (Sprint 1's specs, re-run against a real login).
6. A settings export contains the handle and **no JWT**; the app password is
   never persisted anywhere.
7. Logout offers the three-way leave dialog with Bluesky copy; "leave and keep
   everything" loses no data, "remove everything" clears both identity halves.
8. **An existing Mastodon-primary session with a Bluesky connector is
   byte-identical** — same keys, same values, same behaviour.
9. An existing anonymous session is byte-identical.
10. A self-hosted handle that fails `createSession` gets the honest hint, not
    "wrong password".

## Open questions for the user

1. **What does the left rail call it?** Sprint 1 deferred this. A Bluesky-primary
   card is "your identity" (like the Mastodon account card) rather than "a
   connector" (like today's Bluesky card). If a Mastodon-primary user with a
   Bluesky connector and a Bluesky-primary user see the same 🦋 card meaning two
   different things, that is a wart worth naming now.
2. **Does the Bluesky-primary app show Mastodon-shaped navigation it cannot
   serve** (Explore, Local, server feeds) greyed out, hidden, or as an invitation
   to attach Mastodon? Sprint 4 fills these in; this sprint has to show
   *something* for one release. Hiding is cheapest; an invitation is the better
   funnel and pre-sells Sprint 4.
