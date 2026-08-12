# Bluesky-first — Sprint 2b: the front door, actually

Status: **IMPLEMENTED** (2026-08-12) — pending runtime verification in a browser

`npm run test:ci` green: **3979 tests, 0 failures, manifest clean**, production
build clean. Exit criteria 1–6, 9 and 12 are pinned by specs; 7, 8, 10 and 11
need a browser (see below).

One caveat on the way there: `home-feed-perf.spec.ts :: re-detects after reset`
failed twice mid-sprint at 24ms vs 34ms and passed on a clean re-run. It is a
pre-existing timing flake in code this sprint does not touch (`pages/home/` has
no diff), comparing two single unaveraged samples — exactly the
"policing milliseconds" its own header disclaims. Re-run it alone before
believing it.

## What shipped

- `pages/entry/` — the dispatcher at `/`. Renders nothing; branches four ways.
- `first-run/preview-seed.ts` — the three hardcoded ids, the compiled-in
  snapshot, the single batched refresh, `seed()` / `clear()` / `markEmpty()`.
- `first-run/first-run-modal.*` — the two-step blocking modal, rendered by the
  shell over `/home` so the rails, header, footer and timeline stay visible.
- `pages/front/` **deleted**, with the analytics opt-out moved to `/login`
  (the signed-out page in the current flow) rather than lost.
- `AnonymousFollows.refreshAccount()` — see the latent bug below.

Headline copy, per the product owner: *"Welcome to Mawkingbird, a social media
client for Mastodon, Bluesky and more."* Step one names Mastodon and Bluesky
together, which settles the open question below in favour of naming both.

### One more link fix, found by asking where `/` is referenced

"Look around without an account" on `/login` and `/login/bluesky` pointed at
`/`. Under the dispatcher that seeds a preview and asks *"log in or continue?"*
— which is the question the visitor is answering **by clicking that link**. It
looped them back into it. Both now point at `/anonymous`, which enters directly
with no modal. `anonymous-entry`'s own unreachable-server fallback to `/` is
left alone: there it is an improvement, since `/` now probes the fallback chain
instead of showing a pitch.

### The hardcoded ids, verified against the live server

Worth doing rather than assuming, and it caught a real error. Checked against
`mastodon.social/api/v1/accounts?id[]=…` on 2026-08-12:

| account | id | note |
|---|---|---|
| `@Gargron` | `1` | correct |
| `@Mastodon` | `13179` | correct |
| `@ProPublica@newsie.social` | `109365953730768772` | **first guess was wrong** |

The id originally written for ProPublica (`8365`) belongs to an unrelated
account, `@Gertjan` — so the preview would have opened on a stranger. ProPublica
is also **not local to mastodon.social**: `lookup?acct=propublica` 404s, and the
real handle is `@ProPublica@newsie.social`, which mastodon.social knows under the
id above. That matters beyond the id, because `AnonymousFollows` keys follows on
the *federated handle*: a snapshot with a bare `acct: 'propublica'` would seed
under one key and refresh under another, leaving four follows where there should
be three. Pinned by a spec.

All three snapshots now carry real display names, bios, avatars and counts read
from the live API.

### The roadmap's standing regression clause

Every sprint carries it: an existing Mastodon session and an existing anonymous
session must behave identically. The dispatcher is the one place **every**
account kind passes through, so all three are asserted there rather than
inferred — including Bluesky-primary, which reaches `/home` untouched because
`isAuthenticated` is `kind() !== null`. None of the three seeds a preview.

### What specs cannot prove

Exit criteria 7, 8, 10 and 11 — the OAuth round trip, the seed being gone after
it, a genuinely blocked `mastodon.social`, and the page with remote images
blocked — need a browser. Everything else is pinned by tests.

---

Status when written: PROPOSED (2026-08-12)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Supersedes: [bsky-first-2-front-door.md](bsky-first-2-front-door.md), which is
re-opened as **INCOMPLETE** and now runs *after* this sprint.

**This sprint blocks the rest of the roadmap.** Sprints 3–7 all assume a front
door that works; building more of them on top of the wrong one compounds the
problem.

## What went wrong

Sprint 2 was asked for *"show the app first"* and delivered *"show a page about
the app first"*. Those are not the same thing, and the difference is the whole
point.

The shipped `/` is a marketing landing page: its own route outside the shell, no
header, no left rail, no right rail, and — most importantly — **no posts**. The
sprint plan says so in as many words: *"No shell, no left rail — this is a
landing page."* Twelve avatar cards drawn from `bundled-starter-kits.generated.ts`
stand in for a timeline.

That is still a wall. It is a nicer wall with faces on it, but a stranger who
came to find out what a Mastodon client looks like is again being shown
something that is not one, and asked to make a decision before they see it.

The user's framing, which the previous plan restated but did not implement:

> "Previously, you got a login page. It didn't show the app and people reported
> they were literally afraid to log in for fear that, I don't know, we would use
> their OAuth tokens for nefarious purposes. So we need to show the app first."

**Show the app.** The running app, with the rails, the header, the footer, and
real posts in the middle column.

### What Sprint 2 got right and this sprint keeps

Not a rewrite. These land intact:

- `/login` stays the OAuth callback address (`redirect_uri` is baked into every
  registered app record) and keeps forwarding `?code=`/`?state=`/`?add=` to
  `/login/mastodon`. **This constraint is permanent.** See the
  `oauth-redirect-uri-is-login` memory.
- Today's Mastodon login page lives at `/login/mastodon`, unchanged.
- `/login/bluesky` exists as a route for Sprint 3 to fill in.
- `authGuard` sends a stranger to `/` rather than a login form.
- Analytics opt-out is reachable without signing in.

What changes is what `/` *is*.

## The corrected design

### `/` is a router, not a page

The user's words, and the sentence the last developer needed:

> "`/` probably needs to just be routing code — 'oh, you already got
> credentials, let's send you on your way', or 'oh, you're new here, look, it's
> a Mastodon client, do you want to log in or not', or 'you had the anonymous
> experience last time, so that is what you get until you click the login
> button'."

So `/` renders nothing of its own. It reads existing state and dispatches:

| State on arrival | Where they go |
|---|---|
| Mastodon-primary session | `/home`, straight through |
| Bluesky-primary session | `/home`, straight through |
| Anonymous account already in storage | `/home`, straight through — **no modal**, they already chose |
| Nothing at all (first visit ever) | the preview: `/home` with seeded posts and a blocking modal |

The third row is the one Sprint 2 had no concept of. "Continue without logging
in" is a **durable choice**, not a per-visit one. Someone who made it does not
get asked again; they get the app, with a *Log in* button in the header they can
reach whenever they want.

This kills the returning-signed-in-user risk that Sprint 2 spent a whole row of
its risk table on: `/` cannot show a pitch to a signed-in user because `/` never
shows a pitch to anybody.

### The first visit: the app, seeded, behind a modal

A first-time visitor lands on **`/home` in the ordinary shell** — three columns,
header, footer, everything — with a real timeline of real posts. Over it, a
blocking modal asks the one question.

The timeline is not a mock. We enter Anonymous against `mastodon.social`, seed
three follows, and let the ordinary anonymous home feed render them:

- `@Gargron` — the project's founder; the most recognisable face on Mastodon
- `@Mastodon` — the official account
- `@propublica` — a real newsroom, so the preview is not all meta-Mastodon

Three accounts, chosen by the user, for a specific reason: the earlier idea of
seeding a whole starter kit costs 20+ API calls before the first paint. Three
costs four (one batched account lookup, three status fetches) and reads as a
timeline just as well.

**Why the app is entered before the choice is made.** The modal sits over a live
app, which means the anonymous account exists *before* the user has agreed to
anything. That is deliberate — it is the only way the posts behind the modal can
be real — and it is cheap to undo: the account is browser-local, costs no
network identity, and every exit path cleans up after itself (below).

### The modal, step one

Blocking. No dismiss, no click-outside, no escape hatch — per the user: *"They
have to make a choice to log in or continue without logging in. I don't know
what it would mean for them to just click anywhere."*

Two buttons:

- **Log in** → step two
- **Continue without logging in** → clean up the seed, go to `/home`

Copy names the fact that the posts behind the modal are a preview, so nobody
mistakes three seeded follows for their own account.

### The modal, step two: which network?

Chosen inside the same modal rather than by navigating to `/login`. Navigating
away throws the app back off screen, which is the exact mistake this sprint
exists to fix.

- 🦋 **Bluesky** → `/login/bluesky` (a stub until Sprint 3)
- 🐘 **Mastodon** → `/login/mastodon`

A back affordance returns to step one. The existing `/login` chooser page stays
exactly where it is: it is still the OAuth callback and still the destination
for in-app "sign in" links from a signed-out state.

### Clearing the seed

The user: *"anonymous user unfollows those 3 users, which might be enough to
clear the cache."* It is — `AnonymousFollows.unfollow()` calls
`homeFeedCache.invalidate()` on every removal that hits.

So cleanup is literally three `unfollow()` calls, and it runs on **every** exit
from the modal, not only "continue":

- **Continue without logging in** → unfollow the three, land on an empty home
  feed with the existing follow-somebody invitation.
- **Log in (either network)** → unfollow the three *first*, then navigate. The
  anonymous identity stays in the switcher, as Sprint 1's kinds model
  guarantees, but it is left pristine rather than carrying three follows the
  user never asked for.

Only seeded follows are removed, and only if still present — a user who somehow
followed one of the three for real during the preview is not un-followed behind
their back. Match on the follow `key` the seeder recorded.

### Server fallback

`mastodon.social` is blocked on some networks, and a blocked front door is a
blank first impression. The probe already exists — `probeServerAvailability()`
in `server-availability.ts`, with the candidate list Sprint 2 put in `front.ts`
(`mastodon.social` → `mas.to` → `fosstodon.org`).

That code moves into the new entry point and now runs **before** the preview
paints, since the seed needs a reachable server. Two honest consequences:

1. First paint may wait on one probe. Render the shell and the modal
   immediately; the middle column shows its ordinary loading state. The app is
   visible during the wait, which is the requirement — it is the *posts* that
   arrive a moment later.
2. If every candidate is unreachable, the modal still appears over an empty
   feed, with a line saying the preview could not load. The choice is never
   blocked by a network failure.

The seeded accounts are hardcoded to `mastodon.social` ids, per the user. On a
fallback server those ids are meaningless, so the preview seeds from the
compiled-in snapshot and reads statuses via the account's own origin — the same
`readRef` route the anonymous provider already uses for federated follows.

### Hardcoded ids, and the snapshot behind them

The user asked for hardcoded ids. One wrinkle worth stating: `AnonymousFollows.follow()`
takes a whole `Account`, not an id — display name, avatar and bio all live on
it, and a follow seeded from a bare id renders as a blank author card.

So we compile in a three-account snapshot (the pattern
`bundled-starter-kits.generated.ts` already establishes) **and** refresh it at
runtime with a single batched `/api/v1/accounts?id[]=…&id[]=…&id[]=…` call — the
`accounts-batch-endpoint` memory confirms that returns full accounts. The
snapshot is the fallback, so a failed or blocked lookup costs a slightly stale
avatar instead of an empty preview.

Total first-visit cost: **1 account call + 3 status calls**, with the account
call optional.

**Stacking order, which only matters because it is over a real app.** First
written at `z-index: 300` — above the leave dialog, but *below* the lightbox
(1000), the fail whale (2000) and the update overlay (3000), any of which would
have painted straight over a modal documented as unmissable. Now `1500`:
above everything routine, and deliberately still below the fail whale and the
update overlay, because "the app is broken" and "the app is being replaced"
genuinely do supersede a welcome question.

**A hole in "blocking" that only shows up over a real app.** Because the modal
sits on top of the running shell, the global keyboard shortcuts were still live
underneath it — `g` then `h` would navigate the app *behind* a modal the visitor
cannot dismiss, leaving them looking at a question about a page that is no longer
there. A landing page could not have had this bug, which is a fair illustration
of the difference between the two designs. `Shell.ngOnInit` now holds
`hotkeys.start()` back until the modal is answered.

**A latent bug this uncovered.** `AnonymousFollows.follow()` returns early for an
account already followed, so the refresh above was a no-op against a real server
— the snapshot would have been permanent, and nobody would have noticed until an
avatar changed. More broadly, an anonymous follow caches the whole `Account` at
follow time and had **no way to ever update it**, so any stale display name or
avatar was stale forever. Fixed with `AnonymousFollows.refreshAccount()`, which
updates an existing follow and does nothing for one that does not exist.

## Planned changes

1. **`pages/entry/`** (new) — headless dispatcher at `/`. Reads `Auth.kind`,
   branches four ways, owns the probe and the seed. Modelled on the existing
   headless `pages/anonymous-entry/`.
2. **`first-run-modal/`** (new) — the two-step blocking modal, rendered inside
   the shell over `/home`.
3. **`preview-seed.ts`** (new) — the three ids, the compiled-in snapshot, the
   batch refresh, `seed()` and `clear()`.
4. **`app.routes.ts`** — `/` becomes the dispatcher; the guarded shell's `''`
   child is untouched.
5. **`pages/front/`** — **deleted**, along with its spec. Keeping a pitch page
   nobody routes to is how the next developer gets confused the same way. Its
   analytics opt-out moves to the modal's footer or Settings, whichever reads
   better; the opt-out must stay reachable signed-out.
6. **Header "Log in" button** — must be present and obvious for an anonymous
   account, since that is now a durable state with no other way out.

## Explicit non-goals

- Any Bluesky login logic. Still Sprint 3.
- Restyling `/login/mastodon`.
- Moving or re-registering the OAuth `redirect_uri`.
- Seeding more than three accounts, or a whole starter kit.
- Migrating anonymous state into a logged-in account. Still decided against.
- Changing the shell layout. The preview uses it exactly as it is.

## Risks

| Risk | Mitigation |
|---|---|
| **The seed leaks** — a user ends up permanently following three accounts they never chose. | Cleanup on every exit path, keyed on the seeder's follow keys, plus a spec per path (continue / mastodon / bluesky / reload-mid-modal). |
| **A reload with the modal open** leaves an anonymous account with three follows and no modal, because the account now exists. | Mark the preview state explicitly rather than inferring it from "is anonymous"; a preview-marked account that reloads re-shows the modal. |
| **First paint waits on a network probe**, so the "instant" property Sprint 2 bought is lost. | Shell and modal paint immediately from zero network; only the middle column waits. This is the deliberate trade for showing real posts. |
| **Hardcoded ids rot** — an account is renamed or the id changes. | Compiled-in snapshot means a failed lookup degrades to slightly stale, never empty. |
| **Deleting `pages/front/`** breaks specs and the manifest guard. | Expected; rerun `npm run test:ci -- --update` (`test-manifest-guard`). |
| **Anonymous becomes a dead end** — no visible way to log in later. | The header Log in button is an exit criterion, not a nicety. |

## Exit criteria

1. `npm run test:ci` green; manifest guard clean.
2. A **fresh browser** at `/` sees the ordinary three-column shell — header,
   both rails, footer — with **real posts in the middle column**, behind a
   blocking modal.
3. The modal cannot be dismissed by escape, click-outside, or any control other
   than its two buttons.
4. "Continue without logging in" → `/home`, seed gone, empty feed with the
   follow-somebody invitation, and a **visible Log in button in the header**.
5. A **second visit** by that same anonymous user goes straight to `/home` with
   no modal.
6. A signed-in Mastodon user at `/` reaches `/home` with no modal and no flash
   of anything else.
7. "Log in" → network step → Mastodon reaches `/login/mastodon` with every tab,
   server combo, OAuth and token path working as before.
8. The OAuth round trip still completes end to end, and the seed is gone
   afterwards.
9. "Log in" → network step → Bluesky reaches the stub.
10. With `mastodon.social` unreachable, the preview still paints from a fallback
    server; with **all** candidates unreachable, the modal still appears over an
    empty feed and both choices still work.
11. Preview renders correctly with remote images blocked (this user runs uBlock —
    see `adblocker-class-names`).
12. No route anywhere renders the deleted `pages/front/`.

## Open questions — both answered

1. **Modal copy.** Answered: *"Welcome to Mawkingbird, a social media client for
   Mastodon, Bluesky and more."* One sentence, as predicted — the timeline
   behind the modal does the work a landing-page headline would have had to do
   alone. A second line names the seeded posts as a sample, so three follows
   nobody chose cannot read as "this app picked who I follow".
2. **Does the word "Mastodon" appear in step one?** Answered: yes, alongside
   Bluesky. Naming both is what makes "and more" credible, and it avoids the
   bait-and-switch risk Sprint 2 worried about.
