# Onboarding sprint 2 — The first-run path and the login wizard

Status: **COMPLETE** (2026-09-01). 7 tests added; `make test` green (5597 tests, 0 missing).

All three items were verified in code before implementing. 2.1 and 2.2 both had details wrong in
planning — 2.1 blamed the wrong empty-state element, 2.2 blamed the wrong route — and both were
corrected in place before any code was written.

Two flow changes, one of them marked TOP PRIO by the boss. Both are about the same mistake:
**offering every option at once to someone who does not yet have the context to choose.**

---

## 2.1 — Follow-first: never show a new user an empty feed (TOP PRIO)

**Verified in code 2026-09-01. Two details of the first draft were wrong; the finding stands.**

**Now:** `pages/entry/entry.ts` seeds three follows, enters Anonymous, and lands on `/home` with
the first-run modal over a real timeline. That part works and is well-reasoned. The failure is
what happens *after* the answer.

`Shell.answerFirstRun` (`shell/shell.ts:356`) handles it: it calls `preview.clear()`, sets
`firstRunActive` false, and for `'anonymous'` **starts the hotkeys and returns.** No navigation.
The visitor stays exactly where they are — on `/home`, whose three seeded follows have just been
removed underneath them. The timeline they were looking at while deciding vanishes on the click
that dismissed the modal.

Corrections to the first draft:

- **The blue "you aren't following anyone" banner is not what they see.** `showFollowNudge`
  (`home.ts:563`) requires `!auth.isAnonymous`, so an anonymous first-timer never gets it.
- What they get is the `nothingFollowed` empty state (`home.html:228`): one line — "Your timeline
  is empty — you're not following anyone yet" — and one button, "Find people to follow". Its own
  source comment calls it "the first-run destination", so this screen is doing the job on purpose.

The screen is not badly built. The problem is that it is a **fourth** screen that asks for a
choice, and the three after it ask for three more:

| Step | Screen | What the visitor must decide |
|---|---|---|
| 1 | first-run modal | log in, or not |
| 2 | `/home` empty state | press the one button |
| 3 | `/find-friends` | which of **10 rows** — kits, collections, 12 interest links, search, directory, offsite, contacts, import, invite |
| 4 | `/bundled-starter-kits` | which kit |
| 5 | `/collections/starter/:slug` | finally, "Follow everyone" |

`/find-friends` is a genuinely good hub for someone browsing — rows are ordered by how well each
serves a five-minute-old visitor, with prior-knowledge tools under **Advanced**. It is the wrong
thing to put in front of someone who has just been told their timeline is empty, because it
answers "what are all the ways to find people" when the question is "give me people."

Twitter and Mastodon both force a follow step and neither routes through a hub.

**Change:** on `answerFirstRun('anonymous')`, navigate to the starter kits rather than staying put.
Skip `/find-friends` — it is the hub for *choosing a method*, and onboarding has already chosen one.

Design points settled by the code:

1. **The destination is the kits.** `canFollowKit()` (`collection.ts:275`) is explicitly available
   to anonymous visitors, and "Follow everyone" runs through the importer against the compiled-in
   snapshot, so it works with no account and no network identity. That is the one screen in the
   app where a stranger goes from nothing to a working timeline in one press.
2. **Leaving must stay possible.** The kits page is a normal route with the shell around it, so
   the visitor can navigate away; no extra escape hatch is needed, and no "skip" button should
   compete with the primary action.
3. **The seed cache.** `preview.clear()` removes the follows, and `AnonymousHomeFeedCache` keys on
   `anonymousSourceKey()` (`home.ts:1187`) — the follow/tag set. Following a kit changes that key,
   so the cache cannot serve the old seeded posts. Confirm with a test rather than by reading.

**Files:** `shell/shell.ts` (`answerFirstRun`), `shell/shell.spec.ts`.

## 2.2 — The Mastodon sign-in page is a wall (TOP PRIO)

**Verified 2026-09-01. The first draft named the wrong route; the finding stands and narrows.**

**Correction:** `/login` is **not** this page. It is `LoginChooser`
(`pages/login-chooser/login-chooser.html`), and it is already the wizard step the boss asked for:
one title, two doors (🐘 Mastodon / 🦋 Bluesky) with a plain-language hint each, a quiet
"not sure? browse anonymously instead" way out, and the analytics opt-out. It is 66 lines and it
is good. **Do not rebuild it.**

The wall is `/login/mastodon` (`pages/login/login.html`, 444 lines), reached *after* the visitor
has already answered "which network". So the shape of the fix is not "add a first question" —
that question is asked and answered. It is "stop showing everything at once on the screen that
comes next."

That page renders, in one column, all at the same time:

- hero with logo, brand and tagline;
- a tab row (plus two mock-only tabs against a mock server);
- "not sure which server?" plus a server combobox with a live suggestion list carrying category,
  size and description per row;
- `section.path.path-primary` — "I have an account": an OAuth access-scope radio fieldset, the
  sign-in button, and a `<details>` holding a paste-a-token path;
- `section.path` — "New here", which against a real instance is a link to `/welcome-back` and
  against the mock is a full inline registration form (username, email, password, agree);
- `section.path.anonymous-option` — "Continue anonymously", which embeds
  `<app-server-discovery>`, an entire server-hunting widget.

`.paths` is `grid-template-columns: repeat(3, 1fr)` and collapses to one column at
`max-width: 860px` (`login.css:174`), where `.login-card` also drops to `width: 480px`. It does not
overflow — `max-width: 94vw` catches it — so this is a **density** problem, not a layout bug: three
bordered panels plus a server picker plus a discovery widget, stacked, on a phone.

The deeper problem is order. The server combobox is the first control on the page, and it asks a
question only an existing Mastodon user can answer. A visitor who has just told us "I have a
Mastodon account" is made to configure a host before being offered the sign-in button.

**Change:** keep the page, gate its parts behind the question the boss named — *do you have an
account, or do you need one?*

| Answer | Show |
|---|---|
| I have an account | server field (prefilled), then the OAuth button; token path stays in its `<details>` |
| I need an account | the sign-up route to `/welcome-back`; server suggestions framed as "pick one" |
| Just looking | continue anonymously; `app-server-discovery` behind a disclosure |

Notes:

- **Two of the three sections are already mutually exclusive in practice.** Someone with an account
  never needs the sign-up panel, and vice versa. Nothing is lost by asking first.
- **The server picker moves into the branches that need it**, with the current value prefilled.
- **`app-server-discovery` goes behind a disclosure.** Good tool, terrible default.
- **The mock tabs stay exactly as they are.** They are dev tooling; keep them out of the step model.
- **Reuse the chooser's visual language** (`.door` rows) for the new first question, so the two
  consecutive questions look like one flow rather than two designs.
- **Do not** duplicate `LoginChooser`'s network question here. It has been answered by the time
  this page loads.

**Also found, out of scope:** `login.html:317` carries a hardcoded, untranslated English string
naming **"Mocking Bird"** — both a missed i18n key and an instance of the brand split that
[[onboard-4-discovery-and-brand]] 4.4 covers.

**Files:** `pages/login/login.{html,ts,css}`, `login.spec.ts`.

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
