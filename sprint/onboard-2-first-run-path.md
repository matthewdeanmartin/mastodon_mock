# Onboarding sprint 2 — The first-run path and the login wizard

Status: PLANNED. Follows [[onboard-1-honest-actions]]; 2.1 in particular reads better once the
anonymous actions are honest.

Two flow changes, one of them marked TOP PRIO by the boss. Both are about the same mistake:
**offering every option at once to someone who does not yet have the context to choose.**

---

## 2.1 — Follow-first: never show a new user an empty feed (TOP PRIO)

**Now:** `pages/entry/entry.ts` seeds three follows, enters Anonymous, and lands on `/home` with
the first-run modal over a real timeline. That part works and is well-reasoned — the modal exists
so a stranger sees the app rather than a page about the app. The failure is what happens *after*
the answer.

Picking "Continue without logging in" clears the seed. The visitor is then on `/home` with nothing
followed, looking at `showFollowNudge()` (`pages/home/home.html:5`) — a blue banner reading "you
aren't following anyone" with a `/find-friends` CTA beside it. **A first-time tester read that
banner and did not know what to do next.** It is the correct information in a form people have
been trained to ignore: it looks like an ad, it sits above the fold on a page with no other
content, and it asks rather than leads.

Twitter and Mastodon both solve this the same way, and neither uses a banner: onboarding *forces*
a follow step, and the first feed you ever see already has posts in it.

**Change:** after the first-run modal is answered with `anonymous`, route to the follow-picking
screen instead of `/home`. Same for a fresh sign-in that lands on zero follows.

Design questions this sprint must settle, in order:

1. **Which screen.** `/find-friends` today is a two-row menu (`pages/find-friends/find-friends.html`)
   pointing at `/bundled-starter-kits` and `/bundled-collections` — it is a *directory of
   directories*, one more choice rather than an answer. A forced onboarding step needs actual
   people with actual Follow buttons on the first screen. Either `/find-friends` grows an inline
   picker above its two rows, or onboarding routes past it straight to starter kits. Sprint 4
   merges these surfaces anyway, so prefer whichever choice sprint 4 will not have to undo.
2. **How they leave.** There must be a way out that is not a follow — "skip for now" — or this
   becomes a wall. But it should be the quiet option, not a peer of the primary action.
3. **What Home shows on arrival.** Once they have followed someone, `showFollowNudge()` should not
   fire, and the seeded preview should be gone. Check the interaction with `PreviewSeed.markEmpty`
   and the seed-clearing on modal exit — there is a real risk of the seed being cleared, the user
   following three people, and the anonymous feed cache serving the *old* seeded posts.
   `anonymousSourceKey()` / `AnonymousHomeFeedCache` (`home.ts:735`) is the code to check.

**Keep:** the modal itself, the preview behind it, and the sample note. Those are working.

**Files:** `pages/entry/entry.ts`, `first-run/first-run-modal.ts` consumer, `pages/home/home.ts`
(nudge conditions), `pages/find-friends/*`, routes.

## 2.2 — The mobile login page is a wall (TOP PRIO)

**Now:** `pages/login/login.html` renders, in one 860px column, all at once:

- a hero with logo, brand and tagline;
- a tab row (plus two more tabs against a mock server);
- a "not sure which server?" prompt with a server combo box and a live suggestion dropdown
  carrying category, size and description per entry;
- `<section class="path path-primary">` — "I have an account";
- `<section class="path">` — "New here", with its own registration form;
- `<section class="path anonymous-option">` — "Continue anonymously", which itself embeds
  `<app-server-discovery>`, a whole server-hunting widget.

One `@media (max-width: 860px)` rule (`login.css:174`) reflows it. It does not reduce it. On a
phone this is several screens of scroll in which every block competes, and the visitor must
understand what a "server" is before the page will let them past the first control.

**Change:** make it a wizard. Step one asks the question the boss named — *do you have an account,
or do you need one?* — and nothing else is on screen. Only after that answer does the page show
the machinery that answer requires:

| Answer | Then show |
|---|---|
| I have an account | Network choice (Mastodon / Bluesky), then the server field, then sign in |
| I need an account | Server suggestions → `/welcome-back` (see 2.3) |
| Just looking | Continue anonymously; server discovery stays behind a "pick a different server" link |

Notes:

- **The server picker moves.** It is currently the first thing on the page and it is the single
  biggest source of confusion, because it asks a question only an existing Mastodon user can
  answer. It belongs *inside* the two branches that need it, with a sensible default already
  filled in.
- **`app-server-discovery` goes behind a disclosure.** It is a good tool and a terrible default.
- **The mock tabs (`mockTooling && server.isMock`) stay as they are.** They are dev tooling; do not
  spend wizard design on them, just make sure they do not appear in the wizard's step model.
- **The first-run modal already asks a near-identical question** ("Which account do you have?",
  `first-run-modal.html`). Reuse its wording and its two-step shape so the two do not contradict
  each other. If a visitor arrives at `/login` *from* the modal having already picked a network,
  the wizard should honour that and skip step one.
- Wide screens can keep more on screen at once, but the wizard should be the single
  implementation — do not build a phone layout and a desktop layout separately.

**Files:** `pages/login/login.{html,ts,css}`, `login.spec.ts` (348 lines today — expect substantial
rework), possibly a shared step component with `first-run-modal`.

## 2.3 — "Press Ctrl + D" on a phone

**Now:** `pages/welcome-back/welcome-back.ts` computes
`bookmarkHint = /Mac/i.test(navigator.platform) ? '⌘ + D' : 'Ctrl + D'` and the copy tells the user
to press it. On a phone there is no such keystroke, and `navigator.platform` on iOS reports
`iPhone`, so a phone user is told to press Ctrl + D. The instruction is not merely useless — it is
the first step of a two-step plan, so it stalls the whole flow.

**Change:** detect touch/mobile and give platform-appropriate copy — the share sheet on iOS, the
browser menu on Android — or drop the keystroke entirely and lead with something that works
everywhere: a copyable link, or an explicit "leave this tab open." The page's real job is
"be findable after you sign up on someone else's site," and a bookmark is only one way to do that.

`navigator.platform` is deprecated; use it as a fallback only, behind a coarse-pointer media query
or `navigator.userAgentData` where available.

**Files:** `pages/welcome-back/welcome-back.{ts,html}`, i18n keys `pagesWelcomeBack.step1.*`.

---

## Definition of done

- A brand-new visitor who picks "continue without logging in" lands on a screen with followable
  people on it, not on an empty Home with a banner.
- Skipping that step is possible and lands somewhere sane.
- `/login` on a 390px viewport shows one question at a time; the server picker is not the first
  thing a stranger meets.
- `/welcome-back` never tells a phone user to press a key combination.
- `cd ui && make test` green.
