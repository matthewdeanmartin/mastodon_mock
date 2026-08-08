# Write — Sprint 3: the publish wizard

Status: PLANNED (written 2026-08-08, after sprints 1–2 shipped)

Read `write-0-overview.md`, then the **Delivered** and **Found while implementing** sections of
`write-1-workspace-and-zen.md` and `write-2-pkm-notes-and-todos.md`. Those are this sprint's ground
truth — they record what exists and, more usefully, what already went wrong.

## Product premise

Sprints 1–2 built the writing surface and stocked it with virtuous distractions: your own drafts,
your own notes, a live split preview. This sprint is about the *last* moment — the one where a piece
stops being yours and becomes everyone's.

Today `/write`'s Publish button hands the text to the composer and navigates to Home. That is
honest and it works, but it skips the thing a thoughtful writing tool owes you: a look at what you
are about to do, while there is still time to not do it.

The wizard is four steps, each of which can be turned off:

```
[Publish →]
   │
   ├─ 1. Targets      where is this going?          (Continue / Cancel)
   ├─ 2. Preview      splits + rendered markdown    (Continue / Back / Cancel)
   ├─ 3. Quality      spelling, tags, readability   (Continue / Back / Cancel)
   └─ 4. When         now, or scheduled             (Publish / Schedule / Cancel)
```

**Cancel always means "back to the editor, nothing published, nothing lost."** That is the one
invariant of the whole sprint.

## What sprints 1–2 leave you

### Reuse, do not rebuild

- **`splitText` / `segmentsFor`** (`pages/write/split-modes.ts`) — step 2's preview *is* this
  function. It already measures with `postLength()` (URL-weighted, 23 chars per link) and marks
  over-limit segments. Do not re-measure anything.
- **`WriteWorkspace`** (`pages/write/write-workspace.ts`) — the account-scoped sidecar keyed by
  `DraftItem.key`. `WriteMeta` currently holds `splitMode` and an optional `column` that sprint 4
  will write. **If the wizard needs per-draft state, it goes here**, and the shape must stay one
  sprint 4 can extend.
- **`Drafts.handoff()`** — how `/write` reaches the composer today, and how `/drafts` has always
  done "Edit for post". The wizard's last step should still end in a handoff or in
  `api.postStatus`, not in a third publish path.
- **`pkm/pkm-tags.ts`** — `pkmKinds()` already answers "is this tagged as a note or a to-do", and
  the composer already warns on it in `finishSubmit()`. Step 3 should *surface* that check, not
  re-implement it.
- **`compose/post-length.ts`** — `postLength()`, `findUrls()`, `longUrls()`. `longUrls()` in
  particular is what step 3's "these links are ugly" check should use; it already knows a URL at or
  under the reserved width costs nothing to shorten.

### The publish path as it stands

`WritePage.publish()` calls `drafts.handoff(this.snapshot())` and navigates to `/home`. It is
**deliberately not** wrapped in the unsaved-work guard — handing text to the composer is the
opposite of throwing it away, and prompting "you have unsaved writing" on the way to publishing it
was a real bug caught by its own spec in sprint 1. **Keep that property.** The wizard is a step
*before* the handoff, not a reason to reintroduce the guard.

## Stories

### S3.1 — The wizard shell

A stepper that owns: the current step, forward/back, cancel, and the assembled result. Put the
state machine in its own module (`pages/write/publish-wizard.ts`) with its own spec — the step
sequence with arbitrary steps disabled is the fiddliest logic here and deserves to be testable
without a component.

Rules:

- **Skipped steps are skipped in both directions.** With step 2 off, Back from step 3 lands on
  step 1, not on a hidden step 2.
- **Every step disabled means the button publishes immediately**, exactly as it does today. Someone
  who turns the whole wizard off must not get an empty dialog.
- Cancel from any step returns to the editor with the body untouched.
- Focus moves to the new step's heading on each transition, and the dialog traps focus
  (`appFocusTrap`, `a11y/focus-trap.ts`). Sprint 1's unsaved-work dialog is the reference markup.

### S3.2 — Step 1: targets

Which services this is going to. The composer already owns the real target list — `PostTarget` is
`'fedi' | 'bsky' | 'both' | 'paste' | 'blog' | 'blogger' | 'hugo'`, and `restorableTarget()`
(`compose.ts`) already knows which are *usable right now* given what is linked, flagged on, and
whether the session is anonymous.

**Read that logic, do not fork it.** A target the composer would refuse must not be offerable here.
If reuse means extracting `restorableTarget` into a pure helper both can call, do that — but the
answer must come from one place.

Anonymous sessions see only what anonymous sessions can actually post to.

### S3.3 — Step 2: preview

Two things side by side:

- **The splits** — `segmentsFor(body, mode, { limit })`, rendered as the posts they will become,
  numbered, with lengths and over-limit marks. The split-mode picker is available *here* too: the
  preview is exactly where someone realizes the boundaries are wrong.
- **The rendered body** — the app already has `markdown.ts` (`applyMinimalMarkdown`) and
  `status-text.ts` (`renderStatusText`). Use them. Mastodon does not render Markdown, so be honest
  about which target renders what: a `#heading` is a hashtag on the fedi and a heading on a blog.

An over-limit segment does **not** block Continue. It is shown, loudly, and the user decides — the
server will refuse it if they are wrong, and that is recoverable.

### S3.4 — Step 3: quality checks

**Browser-native spelling only** — decided in the overview and unchanged. The textareas already
carry `spellcheck="true"`; the browser draws the squiggles. **No bundled dictionary.**

What this step ships is repo-local heuristics, each one cheap and explainable:

| Check | Signal | Why it earns its place |
| --- | --- | --- |
| Readability | Flesch-Kincaid or similar, computed locally | The one number that reliably makes people shorten a sentence |
| Long/ugly links | `longUrls()` | Already implemented; offers the existing shortener |
| Repeated words | `the the`, `and and` | The typo spellcheck never catches |
| ALL CAPS runs | > N consecutive caps words | Usually a paste artifact |
| Hashtag sanity | count, and `tag-helper.ts`'s existing liveness data | Ten tags is a smell; a dead tag reaches nobody |
| PKM tags | `pkmKinds()` | Sprint 2's warning, surfaced *before* the last click instead of at it |
| Missing alt text | existing `requireAltText` pref | Already a pref; this is where it becomes visible |

Every check is advisory. None blocks Continue. A check that fires on correct writing is worse than
one that misses something, so when in doubt, do not fire.

### S3.5 — Step 4: now or later

Publish now, or schedule. Scheduling already exists end to end — `api.postStatus(..., { scheduledAt })`,
and `/drafts` uses it for the 99-year "park" trick. Reuse it.

Two honest details from the drafts epic: a far-future `scheduled_at` may simply be refused by an
instance (treat refusal as ordinary error handling, do not clamp speculatively), and the composer's
30-second undo-send is orthogonal to this — do not stack the two into a 30-second delay on a
scheduled post.

### S3.6 — Skipping steps

A `ClientPrefs` entry per step, on the **Writing** settings page sprint 2 created
(`pages/settings/writing/`) — it already owns writing-time behaviour and is anonymous-capable.

Default: **all steps on**. Someone who wants the fast path can turn steps off one at a time, which
is the safe direction — the opposite default would mean the feature ships invisible.

### S3.7 — Coverage

- The step machine: sequences with each subset of steps disabled, back-navigation over skipped
  steps, all-disabled publishing immediately, cancel from every step.
- **Cancel publishes nothing** — assert the absence of a POST. That is the only thing that really
  proves it (the lesson from both prior sprints).
- Step 1 offers no target the composer would refuse; anonymous sees only anonymous-capable targets.
- Step 2's splits match `segmentsFor` exactly; over-limit segments are marked and do not block.
- Each quality check fires on a positive case and, more importantly, **does not fire** on ordinary
  prose.
- Step 4 schedules with the right `scheduledAt`, and a refused date surfaces as an error with the
  body intact.
- Focus lands on each step's heading; the dialog traps focus.

## Traps

Carried from sprints 1–2, all hit for real:

- **`npm run test:ci` only**; `-- --update` after adding or renaming specs. Never format and test
  in one shell invocation.
- `as Status` on a partial fixture fails the build (`TS2352`) — use `as unknown as Status`.
- `httpMock.verify()` does not prove "nothing was published": the page's own `DraftSources.load()`
  and `PkmSource.load()` are in flight. Assert `httpMock.match((r) => r.method === 'POST')` is empty.
- **Two services already scan `/accounts/:id/statuses` on this page.** Specs use
  `flushStatusScans()`; `expectOne` on that URL is wrong by construction.
- `ngModel` writes into a newly-rendered control asynchronously — assert on the bound signal, not
  on `.value`.
- `ClientPrefs` persists through a constructor effect. Do not call `persist()` yourself.
- A11y lint will reject a `(keydown)` on a non-focusable element and a click handler without a
  keyboard equivalent. Put handlers where focus actually is.
- Do not add `ad-*` class names. Never say "X" — it is Twitter.

## Definition of done

`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`,
`npm run build:mockingbird` all pass. Append **Delivered** and **Found while implementing**
sections to this file. Sprint 4 (kanban) is written after this lands.
