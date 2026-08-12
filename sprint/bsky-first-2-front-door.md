# Bluesky-first — Sprint 2: the front door

Status: **INCOMPLETE — superseded** (re-opened 2026-08-12)

> This sprint was marked COMPLETE and then re-opened by the user, who reports
> that it **misunderstood the ask by about 95%**.
>
> "Show the app first" meant *the running app* — shell, both rails, header,
> footer, and real posts in the middle column — with the login question asked as
> a modal on top of it. What shipped is a standalone marketing page with none of
> those things, which is still a wall between a stranger and the product.
>
> **[bsky-first-2b-app-first-front-door.md](bsky-first-2b-app-first-front-door.md)
> supersedes this document and must ship first.** It keeps the parts of this
> sprint that were right — the `/login` callback constraint, `/login/mastodon`,
> the `/login/bluesky` route, the `authGuard` redirect — and replaces `/` with a
> headless dispatcher, deleting `pages/front/`.
>
> The rest of the bsky-first roadmap is blocked until 2b lands.
>
> Everything below is the original record, kept for its findings — the OAuth
> `redirect_uri` discovery in particular is load-bearing and still true.

## Outcome (as originally written)

Shipped. `npm run test:ci` green (3920 tests, 56 added, manifest clean), build
clean, and all ten exit criteria verified in a real browser against the mock
server — including the two that specs cannot prove: the OAuth callback round
trip and the page with remote images blocked.

- `/` is the front page: two doors above the fold, pitch, and twelve real
  starter-kit faces drawn per page load. Zero network calls to paint.
- `/login` is the two-door chooser; today's login page moved to
  `/login/mastodon` **unchanged**; `/login/bluesky` is an honest stub.
- `authGuard` sends a stranger to `/` instead of a login form.
- Analytics opt-out moved to the front page, reasoning intact.

### The discovery that changed the plan

The spec said "the OAuth callback must return to `/login/mastodon`". That is
only half-right, and following it literally would have broken sign-in.

`login.ts` builds its redirect URI as `new URL('login', document.baseURI)` — an
**absolute URL registered with the remote instance** at app-registration time,
which real Mastodon servers validate the callback against exactly. `/login` is
therefore not an internal route; it is a published integration point baked into
every app record already created, and into every flow in flight.

So `/login` **stays** the callback address and `redirect_uri` is unchanged.
The chooser forwards any request carrying `?code=`, `?state=` or `?add=` to
`/login/mastodon` with the query string intact, since `Login` owns
`handleOAuthCallback`. Re-pointing the redirect URI would have worked for new
flows and silently stranded existing ones. Pinned by four specs in
`login-chooser.spec.ts`, and verified live: `/login?code=…&state=…` lands on
`/login/mastodon?code=…&state=…`.

### Two bugs found by tests

1. **`app.routes.spec.ts` broke wholesale.** Its `shellChild()` helper found the
   shell with `routes.find(r => r.path === '')` — which now matches the front
   page. Five tests failed. The helper now identifies the shell by having
   `children`, and new specs pin the front-door structure: `pathMatch: 'full'`,
   declared before the shell, unguarded.
2. **`**` redirected to `''`.** Harmless before; now it would show the pitch page
   to a signed-in user who fat-fingered a URL — reading as a logout, the exact
   failure exit criterion 1 exists to prevent. Now redirects to `home`.

### One judgement call worth recording

`heliomass@cosocial.ca` belongs to **both** `canadian-politics` (withheld) and
`retro-computing` (allowed). The exclusion filters *kits*, not people, so this
account can still be drawn — as a retro-computing account. That is correct: the
rule is about not framing the landing page around war or partisan politics, not
a personal blocklist, and treating it as one would make the rule depend on who
happens to share a kit. My first spec asserted the stricter rule and failed
honestly; it now tests accounts appearing *only* in withheld kits, with a
non-vacuousness guard.

### Still open

The **headline copy** is a placeholder — `A timeline that just shows you your
timeline.` — flagged as such in `front.html` with a comment explaining that it
is deliberately not a "remember when Twitter was good?" variant. The word
"Mastodon" currently appears in the face handles and the chooser, but not in the
headline or subhead. Both remain the product owner's call.

---

Status when written: PROPOSED (2026-08-11)

Parent: [bsky-first-0-overview.md](bsky-first-0-overview.md)
Follows: [bsky-first-1-account-kinds.md](bsky-first-1-account-kinds.md)

## Goal

Replace "here is a login page" as the first thing a stranger sees with **a page
that shows them what the app is**, and demote logging in to one of two buttons
on top of it.

> "For users that are afraid of logging in to a strange app without even seeing
> what it is, they get to see it. This is a huge improvement over the current
> 'here is a login page' as the 1st when people don't even know what this is."

This sprint ships the front page, the login chooser, and the anonymous path.
The Bluesky door is **built but closed** — it routes to Sprint 3's page, which
does not exist yet. The Mastodon door routes to today's login page, unchanged.

## The problem with today's front door

`authGuard` sends every unauthenticated visitor to `/login`. That page is 400
lines of HTML whose first interactive element is a server combo box, followed by
an OAuth scope radio group and an API-token field. "Browse anonymously" is
**Path 3 of 3**, styled `.anonymous-option` and visually secondary.

So the app's opening move is to ask a stranger to choose a Mastodon server and
grant OAuth scopes, before showing them a single post. For a Bluesky user — the
person this whole roadmap is for — it is worse than a wall, it is the *wrong*
wall.

Meanwhile `/anonymous` already exists and is **headless**: a component with
`template: ''` that probes a server, calls `enterAnonymous`, and redirects. All
the machinery, none of the pitch.

## The new flow

```
                    /  (front page, no guard)
                    |
   +----------------+----------------+
   |                                 |
[Log in]              [Continue without logging in]
   |                                 |
   v                                 v
/login  (chooser)              enterAnonymous()
   |                                 |
   +--------+--------+               |
   |                 |               |
[Mastodon]        [Bluesky]          |
   |                 |               |
   v                 v               |
/login/mastodon   /login/bluesky     |
(today's page,    (Sprint 3)         |
 unchanged)          |               |
   |                 |               |
   +--------+--------+---------------+
            |
            v
         /home
```

Both login paths and the anonymous path all land on `/home`. Per the user:
after a successful login you get **the same feeds page the anonymous user got**.

> "Users that will login they can tolerate it, also this is not common."

That is the sizing argument for the whole sprint: the login flow may be several
clicks, because logging in is the rare path. The common path — look at the app —
is now zero clicks.

## Locked product decisions (user, 2026-08-11)

### The front page shows a random subset of the starter kits

Not live trending posts, not static mockups. **Real curated accounts, drawn at
random from the bundled starter kits.**

This is the best available answer and it is worth saying why:

- `bundled-starter-kits.generated.ts` is **84KB of compiled-in snapshots** — 10
  kits, 65 real accounts, each with avatar URL, bio, follower/following/post
  counts. `starter-kits.ts` carries more.
- So the page needs **no network call to render**. It paints instantly, works
  with every public server down, and cannot show a spinner where the nostalgia
  is supposed to be.
- The accounts are **curated**, so the front page cannot open on something
  embarrassing — which a live trending fetch absolutely can.
- Avatars are remote URLs and may fail; that degrades to an initial-letter
  placeholder, never to a broken page.

**Exclusions from the random draw.** The kit list includes `war-in-ukraine` and
`canadian-politics`. "Remember when Twitter was good?" must not open on war
coverage or partisan politics — it undercuts the pitch on the exact emotional
beat the page is trying to hit. Those two kits are excluded from the front-page
draw and remain fully available on `/bundled-starter-kits`. Encode the exclusion
as a named constant with this reasoning as its comment, so it does not read as
an arbitrary omission later.

The draw is **per page load**, seeded from nothing — a returning visitor sees
different faces, which quietly signals breadth.

### Server selection disappears from the front door

Auto-pick `mastodon.social`. If unreachable, silently probe the next known-good
public server and show a small notice **after** entry, never a question before
it. The picker keeps living on the Mastodon login page and in Settings → Server.

`server-discovery` and the combo box are **not deleted** — they move out of the
first-run path, and `/login/mastodon` keeps them exactly as they are today.

### Anonymous stays its own account kind

An anonymous user who browses, follows tags locally and then logs in with
Bluesky gets a **new account**; the anonymous identity is untouched and stays in
the switcher. No migration, no merge, no "bring your tags along?" prompt.

This falls straight out of Sprint 1's kinds model — `_anonymous` and
`_bsky_<hash>` are different scopes, so the two identities cannot collide. It is
the cheapest option *and* the least surprising one, which is a rare alignment.

### The Bluesky door is built closed

The chooser renders both doors. Bluesky routes to `/login/bluesky`, which in
this sprint is a **stub page** saying it is coming, with a link back. The route,
the chooser and the copy all ship now so Sprint 3 only has to fill the page in.

Rejected: hiding the Bluesky button until Sprint 3. The chooser's whole shape —
"which network are you on?" — is the thing being user-tested here, and a chooser
with one door tests nothing.

## Planned changes

### 1. New route: `/` is the front page

- `app.routes.ts`: a new **unguarded** root route rendering `FrontPage`.
- Today `path: ''` sits *inside* the guarded shell and redirects to `home`. That
  guarded empty-path child stays; the new public root is matched first for
  unauthenticated visitors.
- **`authGuard` redirects to `/` instead of `/login`.** One-line change, and it
  is the change that makes the front page the front door.
- An already-signed-in visitor hitting `/` goes straight to `/home` — a returning
  user must never be shown the pitch again.

### 2. New page: `pages/front/`

- Two buttons above the fold: **Log in** and **Continue without logging in**.
- Below: the pitch, then the starter-kit accounts as real cards.
- Reuses the existing account card presentation rather than inventing one.
- No shell, no left rail — this is a landing page.
- The analytics opt-out currently at the bottom of the login page **moves here**,
  with its existing reasoning intact: the person most likely to want it is the
  one who has not signed in yet, and they should not have to log in to find it.

### 3. `/login` becomes the chooser

- Two large targets: 🐘 Mastodon and 🦋 Bluesky, with a sentence each.
- Copy must be legible to someone who does not know what a fediverse is.
- A third, quiet line: continue without logging in (for people who took the
  wrong door).

### 4. Today's login page moves to `/login/mastodon`

- **The component is not rewritten.** It moves, keeps its tabs, server combo,
  OAuth, token path, registration, mock tooling and server discovery.
- Its own "Browse anonymously" Path 3 stays where it is — harmless, and it is the
  fallback for anyone deep-linked past the front page.
- `/login` deep links from elsewhere in the app must be audited: some mean "go
  authenticate" (→ chooser) and some mean "go do Mastodon OAuth" (→
  `/login/mastodon`). Enumerate them; do not assume.

### 5. `/login/bluesky` stub

Placeholder page, real route, honest copy. Sprint 3 replaces the body.

### 6. `/anonymous` keeps working

The headless entry point stays for shareable `/anonymous?some.server` links. It
gains nothing and loses nothing.

## Explicit non-goals

- **Any Bluesky login logic.** Sprint 3.
- Rewriting or restyling the Mastodon login page. It moves; that is all.
- Deleting the server picker or discovery widget.
- Any change to `/home` or the shell.
- Migrating anonymous state into a logged-in account. Decided against, above.
- Live post fetching on the front page. Decided against, above.

## Risks

| Risk | Mitigation |
|---|---|
| **A returning signed-in user gets shown the marketing page.** The single worst outcome here — it reads as "the app logged me out". | `/` checks `auth.isAuthenticated` and redirects to `/home` before paint. Spec'd explicitly, and it is the first exit criterion. |
| **Deep links to `/login` break** or land on the wrong page. | Audit every `/login` reference (router links, guards, `prepareReauth` callers, the OAuth callback) and classify each as chooser-or-mastodon. The OAuth callback is the dangerous one: it must return to `/login/mastodon`, since that component owns `handleOAuthCallback`. |
| **Front-page avatars fail to load**, leaving a grid of broken images under "remember the good Twitter?". | Initial-letter placeholder fallback on every avatar. Verify with images blocked — the `adblocker-class-names` memory is a reminder that this user runs uBlock, and remote avatar hosts are exactly what gets blocked. |
| **`login.spec.ts` (13KB) breaks** on the route move. | The component is unchanged, so the spec should move with it and pass. If it fails, the move was not a move. Manifest guard will flag the rename — rerun with `-- --update`. |
| **The random draw shows the same faces every time** because of module-level evaluation. | Draw inside the component, per construction, not at module scope. |

## Exit criteria

1. `npm run test:ci` green; manifest guard clean.
2. A **fresh browser** at `/` sees the pitch and real starter-kit faces, with no
   network call required to paint, and with no server picker anywhere on the page.
3. **A signed-in user at `/` lands on `/home` without seeing the front page** —
   for mastodon-primary and anonymous accounts alike.
4. "Continue without logging in" reaches `/home` with a working anonymous feed,
   in one click, no questions asked.
5. With `mastodon.social` unreachable, that same click still succeeds against a
   fallback server, and the notice appears **after** entry.
6. "Log in" → chooser → Mastodon reaches today's login page with **every** tab,
   the server combo, OAuth and token paths working as before.
7. The OAuth round trip still completes end to end (this is the regression most
   likely to slip through — it leaves the app and comes back).
8. "Log in" → chooser → Bluesky reaches an honest stub.
9. `war-in-ukraine` and `canadian-politics` never appear in the front-page draw;
   both still reachable at `/bundled-starter-kits`.
10. Front page renders correctly with remote images blocked.

## Open question for the user

**What is the actual headline copy?**

I have been writing around "Remember when Twitter was good?" as a placeholder.
The `never-say-x-say-twitter` memory says the nostalgia play *is* the pitch and
the X rebrand is what it reacts against — so the headline is load-bearing
product copy, not decoration, and I would rather you wrote it than have me guess.

Worth deciding at the same time: whether the page says the word "Mastodon"
above the fold at all. The argument for burying it: a Bluesky user does not care
and may actively bounce. The argument against: it is what the accounts on screen
actually are, and hiding it is the kind of thing that feels like a bait-and-
switch once they notice.
