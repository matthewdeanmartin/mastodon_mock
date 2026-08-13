# Bluesky-first — Sprint 7: find your people

Status: **COMPLETE (2026-08-13).**

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-6-anonymous-bsky.md](bsky-first-6-anonymous-bsky.md)

Last sprint on the roadmap, and the only one that is **new product** rather than
the inversion of existing product. Everything before it took something the app
already did for Mastodon and taught it to be network-agnostic. This one does
something the app has never done in any direction.

## The question

> "Who that I follow on Mastodon is also on Bluesky?"

And — decided at scoping time, see below — its mirror. A person maintains two
follow graphs that were built at different times for different reasons, and has
no idea how much they overlap. The overlap is the answer.

## What is genuinely not there yet

Worth stating flatly, because the obvious assumption is that this is a fourth
copy of something that exists three times already.

`ui/src/app/pages/settings/import-export/` holds three discovery paths:

| File | Source | Target |
|---|---|---|
| `settings-import-export.ts` | pasted handles / `following_accounts.csv` | Mastodon |
| `twitter-friend-discovery.ts` | a Twitter archive folder | Mastodon |
| `github-friend-discovery.ts` | GitHub following | Mastodon |

`grep -rn "bsky\|bluesky" pages/settings/import-export/*.ts` returns **nothing**.
Every existing path terminates in a Mastodon follow, and every source is a
*foreign* system — an archive, another site. None of them reads one of the user's
own live networks and matches it against the other. So there is real reuse to
take (the ranking/row/bulk-follow shape) and a real gap to fill (the sources, the
directions, and the budget).

## Decisions (user, 2026-08-13)

1. **It lives inside Import/Export Friends.** Not its own nav entry — that list is
   already 30 entries long — and not under Connections/Bluesky, which would frame
   a two-network tool as belonging to one of them. It is a fourth `<section>` on
   the page that already means *find people from elsewhere*.

2. **Symmetric from the start.** Not "Mastodon follows → Bluesky" with the
   inverse deferred to a later sprint. One network-agnostic engine parameterised
   by `{source, target}`, and both directions ship together. The roadmap's
   one-liner named only one direction; a Bluesky-primary user with a Mastodon
   connector wants the other one, and after six sprints of un-Mastodon-ing the
   app, shipping the Mastodon-first half alone would be a step backwards.

3. **Review, then bulk-follow.** Checkboxes per match and a `Follow selected`
   action, the same shape as the Twitter flow. Nothing is followed without an
   explicit click.

4. **Both sides must be credentialed — and the section is *disabled*, not
   hidden.** Anonymous is excluded on purpose, and the reason is cost, in the
   user's words:

   > "because we want to discourage people from 'wasting' 100s or 1000s of API
   > calls. Anonymous users would have to do this all over someday."

   That is the correct read. An anonymous follow list is browser-local; a scan
   run against it buys results the person loses the moment they sign up properly
   and start a real follow graph. But the section still **renders, greyed out,
   with the reason** — because a disabled bridge finder is the single best
   argument for attaching the second account:

   > "Give people a motivation to set up the other account."

5. **Free pass first, then a budgeted scan.** See below — this is the sprint's
   main piece of engineering.

6. **Match *kinds*, not just scores.** `exact` / `strong` / `weak`, each row
   carrying the human-readable signals that produced it. Weak matches are shown
   but unchecked by default.

## The cost problem, and the two-pass answer

Bluesky has no "search these 500 handles" endpoint. Naively, matching an N-follow
list is N × `searchActors`. At 500 follows that is 500 calls to answer one
question, which is exactly the waste decision 4 exists to prevent. Pacing alone
does not fix it — 200 scanned is still 200 calls.

So the scan is two passes, and the first one is free.

### Pass 1 — the bio pass (zero extra API calls)

The follow-list responses **already contain** the bios. `app.bsky.graph.getFollows`
returns `profileView` with `description`; Mastodon's `/following` returns `note`
plus `fields`. People routinely write their other handle right there —
`@someone.bsky.social` in a Mastodon bio, a `mastodon.social/@someone` link in a
Bluesky one, or a verified `fields` row pointing at the other profile.

Pass 1 reads text the app has already paid for and extracts candidate handles.
Confirming one costs a single `resolveHandle` (Bluesky) or one account lookup
(Mastodon) — not a search — and yields an `exact` match, the highest confidence
kind available, because the person *told us themselves*.

This is the best calls-per-match ratio in the sprint by a wide margin, and it
runs before the user is asked to spend anything.

### Pass 2 — the budgeted scan (explicit, counted, stoppable)

Whoever pass 1 missed goes into a scan the user opts into with a **budget**: 50 /
200 / all, a running counter, and a stop button. One `searchActors` per remaining
person, ranked into `strong` / `weak` by name and bio signals. Stop-early keeps
what it found — same shape as the effective-audience scan, which already
established this pattern in the app.

Progress persists across visits so a stopped scan resumes rather than restarts;
re-scanning people pass 1 or a previous pass 2 already resolved is itself waste.

## Shape of the work

- **`bridge-finder.ts`** — the engine, network-agnostic over `{source, target}`.
  Walks the source follow list, runs pass 1, exposes the leftovers, runs a
  budgeted pass 2, emits `BridgeMatch[]` with kinds and signals. Mirrors
  `twitter-friend-discovery.ts`'s `rank*` / row-status structure so the two read
  as siblings.
- **Follow-list walkers.** Mastodon: `accountFollowingPage` — **not**
  `accountFollowing`; `/following` paginates by relationship id, and guessing
  `max_id` from the last account re-reads page one forever (already documented in
  `api.ts`, and a trap this sprint would otherwise walk straight into). Bluesky:
  `getFollows` with its cursor.
- **The section** in `settings-import-export.html`: direction picker, gate/pitch
  when a side is missing, pass-1 results, budget control, pass-2 results,
  bulk-follow.
- **Page-level copy pass.** The page's subtitle currently reads *"Move your
  friends between Mastodon accounts with a portable CSV file"* and its invite
  callout assumes a Mastodon target. A symmetric two-network tool makes that
  header wrong. Small, but not optional — this is the sprint that stops the page
  being Mastodon-shaped.
- **Ids stay namespaced** (`bsky:<did>`), and nothing outside `providers/` learns
  a second protocol exists: the engine consumes `Account` on both sides, as
  standing constraint 2 requires.

## Exit criteria

1. A Mastodon-primary user with a Bluesky connector opens Import/Export Friends,
   runs the free pass, and sees exact matches **without having spent a single
   search call**.
2. The budgeted scan finds strong/weak matches over the leftovers, shows a live
   counter, stops on demand, and keeps what it found. **Partially met:** a
   stopped scan resumes within the session, but progress does not survive a
   reload — see "what the next sprint inherits".
3. Selected matches are followed in bulk on the target network.
4. Both directions work; a Bluesky-primary user with a signed-in Mastodon
   connector gets the mirror image.
5. Missing a credentialed side renders the section **disabled with the reason and
   a link to attach the other account** — never hidden, never blank.
6. Anonymous sees the same disabled state, and the app spends no scan calls for it.
7. An existing Mastodon session sees no change anywhere else on the page.

## What was actually built (2026-08-13)

Four files, 30 new tests, suite at **4065 green** (from 4035).

| File | Job |
|---|---|
| `bridge-matching.ts` | The pure half: handle extraction, match *kinds*, ordering |
| `bridge-finder.ts` | The engine: the walk, both passes, the budget, bulk follow |
| `settings-import-export.{ts,html,css}` | The section, the gate, the copy pass |

Three things worth recording because they were found by building rather than by
planning:

1. **The free pass nearly didn't work.** Mastodon renders a bio link as
   `<a href="https://bsky.app/profile/alex.bsky.social">alex</a>`, where the link
   *text* is a truncated label and the handle exists only in the `href`. Stripping
   tags before scanning — the obvious way to plain-text an HTML bio — throws away
   the only copy of the handle, and would have made pass 1 miss every linked
   profile while still looking like it worked. `plainText()` now lifts `href`
   values out before stripping. This is the single highest-leverage line in the
   sprint.

2. **`getProfiles` beat `resolveHandle` for confirmation.** The plan said pass 1
   would confirm a bio-found handle with one `resolveHandle` each. `getProfiles`
   takes **25 actors per call** and returns viewer state as well, so confirmation
   is ~25× cheaper *and* the Bluesky side learns which matches are already
   followed for free — no relationship call at all. Only the Mastodon direction
   still spends one lookup per clue, because Mastodon has no batch lookup.

3. **`followAll` had to clear the stop flag.** `stop()` and a rate-limited scan
   both leave it set, and a user who then ticks boxes and clicks Follow is
   starting a new action, not resuming the cancelled one. Without the reset that
   click was a silent no-op — caught by a test written for exactly that sequence.

Verified against the live API before building: `app.bsky.graph.getFollows`
returns `description` on every entry, anonymously (probed 2026-08-13). The whole
two-pass design rests on that field being there, and the type in
`bluesky-types.ts` is documented as "only what the adapter consumes", so it was
worth confirming rather than assuming.

### What the next sprint inherits

- **The engine is symmetric but the UI names two directions explicitly.** Adding
  a third network means generalising `BridgeNetwork` and the direction picker;
  nothing in `bridge-matching.ts` assumes there are exactly two.
- **Custom-domain Bluesky handles are found only by pass 2.** `hboon.com` is a
  real handle and a real homepage, and free text cannot tell them apart, so pass 1
  deliberately ignores bare domains rather than spending a lookup per website in
  every bio. If a cheap bulk "is this domain a handle" check ever exists, those
  people move into the free pass.
- **Scan progress is per-session.** Rows persist while the page is open and a
  stopped scan resumes, but a reload starts over. The plan called for resumable
  progress across visits; that needs a store and was not built.

## Deliberately out of scope

- **Starter packs** (`app.bsky.graph.starterpack`), flagged at the end of Sprint 6
  as the highest-value follow-on: the answer to *a fresh anonymous Bluesky feed is
  empty*. Related — both are "get a feed going" — but it is a seeding tool for
  people with no graph, where this is a correlation tool for people with two. It
  wants its own sprint.
- Continuous/background correlation. This runs when asked, and only then.
