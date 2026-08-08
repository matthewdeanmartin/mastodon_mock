# Write — Sprint 2: notes and to-dos (the writing slice of PKM)

Status: COMPLETE (implemented 2026-08-08; not yet smoke-tested against a live account)

Read `write-0-overview.md` and `write-1-workspace-and-zen.md` first — including its **Delivered**
and **Found while implementing** sections, which are this sprint's ground truth. **Sprint 1 is
complete**; this sprint fills the right pane it built and left as an honest placeholder.

## Scope boundary — read this before anything else

**PKM is its own epic, and it is a much larger one than this sprint.** Where it is eventually
going, per the boss: a full workflow manager, deeply integrated with the scheduler, a calendar, all
posts, links, and bookmarks.

**None of that is in this epic.** This sprint builds only the slice of PKM that touches *writing* —
enough that the writer's right pane has the user's own notes and unanswered to-dos in it instead of
somebody else's trending hashtags.

| In scope (this sprint) | Out of scope (the PKM epic) |
| --- | --- |
| The tag model: `#NOTE` / `#TODO` / `#CAL` recognition | Any workflow state machine (open → doing → done) |
| Configurable tag words (i18n) | Calendar surface, date parsing, reminders, recurrence |
| A read source over local drafts + own self-posts | Scheduler integration; deadlines that fire |
| The notes pane in `/write` | Bookmarks, links, and saved-search integration |
| "Save as to-do" from a post's `⋯` menu | Backlinks, tags-as-graph, full-text search over PKM |
| A filterable PKM feed | Any PKM item that is not post-shaped |
| A warning before publishing a tagged post | Cross-device sync beyond what self-posts already give |

**The design constraint that follows from this** is the important part: build the model so the PKM
epic *extends* it rather than *migrates* it. Concretely —

- `PkmKind` is an open enum in spirit. Adding a fourth kind later must be a vocabulary entry and a
  chip, not a schema change. Do not write exhaustive `switch` statements over it that a new kind
  would silently fall through; prefer lookups keyed by kind.
- `PkmItem` carries `source` as a discriminated union (`local` | `self`) exactly as `DraftItem`
  does. The PKM epic will add sources — bookmarks, links, scheduled items — and that union is where
  they go. Nothing outside `pkm-source.ts` may assume there are only two.
- Keep `pkm/` a real module boundary. The writing surfaces import *from* it; it imports nothing from
  `pages/write/`. When the PKM epic builds its own surfaces, they should be able to import the same
  module without dragging the writer in.
- Do not invent a workflow-status field "for later". Sprint 4's kanban has its own sidecar, and the
  PKM epic will design its own; a half-guessed status field now is a migration later. This is the
  same reasoning that put kanban status in a sidecar rather than on the draft.

If a story in this sprint starts growing toward the right-hand column, stop and leave it for the
epic. Boiling the ocean here is the failure mode.

## Product premise

A social client is already a place where you write short things down. The gap is that those things
vanish into a timeline. `#NOTE` and `#TODO` turn a post-shaped thing into a **productivity object**:

- **`#NOTE`** — something you wrote down to keep. A thought, a quote, a link with a reason.
- **`#TODO`** — something you owe a response to. "Reply to this later", "write about this later".
  The canonical way to make one is a quote-post to yourself.
- **`#CAL`** — a dated thing. **Recognized only.** This sprint parses no dates, shows no calendar,
  and schedules nothing — it exists so the vocabulary and the filter chips have the right shape
  when the PKM epic builds the calendar behind it. Recognizing a kind you do not yet act on is
  cheap; renaming one later is not.

These are the virtuous distractions. While you write, the right pane shows your own notes and your
own unanswered to-dos, not somebody else's trending hashtag.

## The two hard constraints

1. **It must work anonymously and against real mastodon.social.** Mastodon has no notes API. A PKM
   item is therefore either a local draft carrying the tag, or a real self-post (`direct`, no
   mentions) carrying it — exactly the both-kinds merge `DraftSources` already does.
2. **The tag words are configurable.** `#TODO` is English. Someone writing in German wants `#TODO`
   *or* `#AUFGABE`, and the feature is worthless to them if the word is hardcoded. This is an i18n
   requirement, and it is the reason the model is "a set of configured words per kind" rather than
   three string constants.

## What sprint 1 and earlier leave you

- `DraftSources.items()` — the merged four-kind list, already a signal, already anonymous-safe.
- `isSelfDraft()` (`pages/drafts/draft-items.ts:91`) — `direct` + zero mentions + recent. **Read its
  doc comment before touching anything nearby.** Missing `mentions` is deliberately treated as "not
  a draft", because showing someone's real private message in a drafts list is far worse than
  omitting a note-to-self. That reasoning applies verbatim here.
- `SELF_DRAFT_MAX_AGE_DAYS = 30` (`draft-items.ts:66`) bounds the self-post scan. **A note is not
  a draft and must not inherit that bound** — see S2.3.
- `ClientPrefs` + `scopedKey()` for the configurable tag words.
- `compose/tag-helper.ts` and `status-text.ts` for existing hashtag handling — reuse their
  extraction rather than writing a fourth hashtag regex.
- Status cards already have a `⋯` menu; S2.5 adds one item to it.

### Specifically from sprint 1 (verify these still hold, then build on them)

- **`WritePage`** (`pages/write/write-page.ts`) and its template. The right pane is
  `<aside class="pane pane-right">`, currently holding one `.pane-placeholder` paragraph. Replace
  that paragraph's contents; the pane, its `aria-label`, its `rightOpen()` collapse toggle and its
  narrow-screen behaviour are already built and tested.
- **`WriteWorkspace`** (`pages/write/write-workspace.ts`) — the account-scoped sidecar keyed by
  `DraftItem.key`. If a PKM item needs per-item workspace metadata, it goes here, and **`WriteMeta`
  must stay a shape sprint 4 can extend** rather than gaining a workflow-status field (see the
  scope boundary above).
- **`WritingZen`** (`writing-zen.ts`) — `zen.active()`. **The notes pane must be hidden in writing
  zen.** That is the whole point of writing zen, and sprint 1's shell specs assert the chrome is
  gone; add the equivalent assertion for the notes pane.
- **`Drafts.update(id, snapshot)`** — new in sprint 1, returns `false` when the id is gone. The
  "jot a note without leaving the editor" affordance (S2.4) must not clobber the draft being
  edited: use `save()` for the new note, never `update()` on the open draft.
- **`splitText` / `segmentsFor`** (`pages/write/split-modes.ts`) — if a note is saved as a local
  draft, decide its split mode deliberately. A one-line note should almost certainly be `demand`
  (one segment), not `rule`.

### Traps sprint 1 hit, that this sprint will hit too

- `as Status` on a partial spec fixture fails the build with `TS2352` once it looks close enough to
  a real `Status`. Use `as unknown as Status`.
- `httpMock.verify()` does **not** prove "this page issued no requests of its own" — it also catches
  `DraftSources.load()`. To prove the anonymous path posts nothing, assert
  `httpMock.match((r) => r.method === 'POST')` is empty.
- `ngModel` writes into a newly-rendered textarea asynchronously; `.value` is `''` right after
  `detectChanges()` and `vi.runAllTicks()` does not flush it. Assert on the bound signal instead.
- An effect that reads `DraftSources.loaded()` only settles synchronously on the anonymous path.
  `PkmSource` will have the same property — do not treat an unsettled list as complete.

## Stories

### S2.1 — The PKM model

A pure module, `pkm/pkm-tags.ts`, with its own spec. No Angular, no HTTP.

```ts
export type PkmKind = 'note' | 'todo' | 'cal';

/** The configured words for each kind, lowercased, without the leading #. */
export interface PkmVocabulary {
  note: string[];
  todo: string[];
  cal: string[];
}

export const DEFAULT_PKM_VOCABULARY: PkmVocabulary = {
  note: ['note'],
  todo: ['todo'],
  cal: ['cal', 'calendar'],
};

/** Which PKM kinds a body carries, in a stable order. */
export function pkmKinds(text: string, vocab: PkmVocabulary): PkmKind[];
```

Matching rules, decided here so three implementations don't diverge:

- Case-insensitive. `#todo`, `#TODO`, `#ToDo` are the same tag — Mastodon itself treats hashtags
  case-insensitively.
- The whole tag must match a configured word. `#todos` is not `#todo`; substring matching would
  make `#notebook` a note.
- A body may carry several kinds. A post tagged `#NOTE #TODO` is both, and the feed shows it under
  both filters.
- Extract hashtags with the existing helper, not a new regex.

### S2.2 — Configurable vocabulary

`ClientPrefs.pkmVocabulary`, account-scoped via `scopedKey()` (it is language- and person-specific,
and must not follow a user across logins). Surfaced on a settings page — the Blue/Appearance
`blue-controls.html` cluster is the wrong home for a three-field text input; put it on the settings
page that already owns writing/posting behaviour and link to it from `/write`.

Editing is per kind, comma-separated, normalized on save (strip `#`, lowercase, drop blanks,
dedupe). An empty list for a kind means that kind is **off** — a legitimate choice, and the UI must
say so rather than silently restoring the default.

### S2.3 — The PKM source

`pkm/pkm-source.ts`, modelled directly on `DraftSources` — independent per-source loading,
per-source error capture, anonymous fast path.

Two sources:

- **Local** — `Drafts.drafts()` filtered by `pkmKinds()` over the joined segments. Free, instant,
  live.
- **Self-posts** — the account's own recent statuses that are `direct` with no mentions *and* carry
  a PKM tag.

Reuse the self-post *predicate* but **not** its 30-day bound. A to-do you wrote six weeks ago is
still owed a reply; a draft you abandoned six weeks ago is not a draft any more. Give PKM its own
constant (start at 180 days) and say why in a comment beside it.

Practically this means one scan of `GET /api/v1/accounts/:id/statuses` with a larger limit than
`SELF_SCAN_LIMIT = 40`, paginating until the age bound or a page cap — **cap it** (3 pages) so a
prolific account doesn't fire fifteen requests on route entry.

**Anonymous sessions issue zero requests and show local items only.** Copy `DraftSources.load()`'s
`auth.isAnonymous` early return.

One `PkmItem` shape, mirroring `DraftItem`: `key`, `kinds: PkmKind[]`, `at`, `preview`,
`source: { kind: 'local' | 'self', … }`.

### S2.4 — The notes pane

The right pane of `/write` becomes the live PKM list: filter chips for All / `#NOTE` / `#TODO` /
`#CAL`, newest first, compact rows with the kind badge and a preview. Reuse the `.chip` and
`.draft-row` styles the left pane already has — the two panes should read as one page.

Clicking a row loads it into the editor under the same rule sprint 1 implemented and specced:
**local continues in place, every other kind hands over a copy and the original stays put**.
`WritePage.open()` is the reference; the notes pane should route through the same method rather
than growing a parallel one.

An affordance to jot a new note without leaving the editor — one line, saved as a local draft with
the configured tag appended. **Writing a note must not cost you the draft you are editing:** it
saves a *new* draft and must not touch `editing()`, the body, or the dirty flag. Sprint 1's
unsaved-work guard is the thing to be careful around here; a note jot must not trip it.

Hidden entirely in writing zen — sprint 1 already hides the whole `.panes` grid, so verify rather
than rebuild, and add the assertion.

### S2.5 — Quote-to-self as a to-do

A `⋯` menu item on any post: **"Save as to-do"**. It creates a quote-post to yourself carrying the
configured `#TODO` tag — the canonical "reply to this later".

Default it to a **local draft**, not a published self-post. A `direct` post is a real server post,
and one menu click should not publish anything, even to an audience of one. Offer the self-post
variant explicitly (a checkbox in the confirm, or a pref), so "travels between my devices" stays
available for people who want it.

Anonymous users get the local variant, which needs no server at all.

### S2.6 — The PKM feed

**A tab inside `/write`, not a `/pkm` route.** Decided — do not revisit it in this sprint.

The reasoning is the scope boundary. `/pkm` is the PKM epic's front door, and that epic will want
it for a surface far richer than a filtered list — one that answers to bookmarks, links, the
calendar and the scheduler as well as to writing. Claiming the route now with a thin version of it
means the epic either inherits a shape that doesn't fit or breaks a URL people have bookmarked.
A tab inside the workspace is honest about what this is: the writer's view of PKM.

The tab lists every PKM item with filters: **all**, **`#TODO`**, **`#NOTE`**, **`#CAL`**.

It exists for the shopping-list problem: to-dos are supposed to be "read this later" / "write about
this later", but somebody will absolutely put their groceries in there. That is fine and it is not
our business — but it does mean the to-do list is a **feed**, with the volume a feed has, and it
needs a filterable surface rather than only a narrow pane.

Build the list as a component the tab hosts, not as logic inside the workspace page, so the PKM
epic can mount the same component at `/pkm` without unpicking it.

> **NOT DONE AS SPECIFIED.** The notes list shipped as inline markup in `write-page.html`, reading
> `PkmSource` directly, rather than as a standalone component. The *model* boundary held —
> `pkm/pkm-tags.ts` and `pkm/pkm-source.ts` are clean, import nothing from `pages/write/`, and are
> what the PKM epic actually needs — but the **view** was not extracted. Mounting this list at
> `/pkm` today means lifting markup out of the workspace template first.
>
> Cost is small (one list, ~40 lines of template) and it is not urgent. Recorded rather than fixed
> because pretending otherwise would mislead the epic that inherits it.

### S2.7 — The publish warning

Publishing something that carries a PKM tag warns first: *"This is tagged `#TODO`. Publishing posts
it to your followers."* Continue / Cancel, defaulting to Cancel.

Two reasons it is a warning and not a block: a public `#NOTE` post is a legitimate thing to want,
and a hard block on a hashtag would be infuriating the first time it is wrong.

Enforce it at **`submit()`** in the composer, not in the template. That is the lesson
`drafts-sprint03` recorded the hard way — a hotkey, an Enter handler, or a future call site must not
be able to publish around it. Add a pref to suppress the warning for people who publish notes on
purpose.

### S2.8 — Coverage

- `pkmKinds()`: case-insensitivity, whole-tag matching (`#todos` ≠ `#todo`, `#notebook` ≠ `#note`),
  multi-kind bodies, custom vocabulary, an empty vocabulary disabling a kind.
- Vocabulary normalization: `#` stripped, lowercased, deduped, blanks dropped; account-scoped.
- `PkmSource`: local-only when anonymous **with an assertion that no request was issued**; the
  180-day bound; the page cap; a self-post *with* mentions is never surfaced.
- Loading a self-post note leaves the original in place.
- "Save as to-do" creates a local draft by default and posts nothing.
- The publish warning fires from `submit()`, and the suppression pref works. Assert the *absence*
  of a request on cancel — that is the only thing that really proves it.
- Jotting a note leaves the open draft's body, `editing()` and dirty flag untouched, and does not
  trip the unsaved-work guard.
- The notes pane is absent in writing zen.

## Traps

- **`npm run test:ci` only**; `-- --update` after renaming a spec.
- **Never format and test in one shell invocation.**
- Vitest fetch traps: `restoreAllMocks` keeps call logs, and a reused `Response` body reads once.
- Do not add `ad-*` class names.
- `isSelfDraft`'s "missing mentions means not a draft" rule is a privacy decision. Do not relax it.
- A larger self-post scan is the one place this sprint can get slow or rate-limited. Cap the pages,
  and check `/observability` after a real run against mastodon.social.

## Definition of done

`npm run lint`, `npm run format:check`, `npm run test:ci`, `npm run build`, and
`npm run build:mockingbird` all pass. Append **Delivered** and **Found while implementing** sections
to this file. Sprint 3 (the publish wizard) is written *after* this lands, grounded in what shipped.

---

## Delivered

### New files

| File | What it is |
| --- | --- |
| `pkm/pkm-tags.ts` (+spec) | The pure model. `pkmKinds`, `withPkmTag`, vocabulary parsing/normalizing. No Angular, no HTTP. |
| `pkm/pkm-source.ts` (+spec) | `PkmSource` — local drafts + tagged self-posts, merged, with the anonymous fast path. |
| `pages/settings/writing/settings-writing.{ts,html}` | The vocabulary editor and the publish-warning toggle. |

### Changed

- `client-prefs.ts` — `pkmVocabulary` (account-scoped, own key `mockingbird_pkm_vocabulary`) with
  `setPkmVocabulary` / `resetPkmVocabulary`; `warnOnPkmPublish` (global blob, defaults **on**).
- `pages/write/write-page.{ts,html,css}` — the notes pane replaces the placeholder; a **Notes &
  to-dos** tab beside the editor; the jot box; `openNote()`.
- `compose/compose.{ts,html}` — `pkmWarning` signal, `confirmPkmAndSend()`,
  `dismissPkmWarning()`, and `submit()` split so `finishSubmit()` is the shared tail.
- `status-card/status-card.{ts,html}` — **Save as to-do** in all three `⋯` menus, reusing the
  existing `actionNotice`.
- `app.routes.ts` + `settings-shell.ts` — `/settings/writing`, anonymous-capable, listed after
  "Posting & Privacy".

### Decisions taken while building

- **The status-card action saves a local draft and posts nothing.** One click on a menu must never
  publish, not even `direct` to an audience of one. The self-post variant stays a `/write` decision.
- **A jotted note gets `demand` split mode.** A one-line note reopened under the `---` default
  would let a stray dash split "a note --- with a dash" into two posts.
- **The notes tab keeps the editor in the DOM** (`.hidden-tab { display: none }`) rather than
  `@if`-ing it away, so switching tabs mid-paragraph cannot destroy an unsaved body.
- **Kind counts count an item once per kind.** A post tagged `#NOTE #TODO` shows under both chips,
  so the chip totals deliberately sum to more than the item count.
- **`isSelfNote` drops the 30-day bound but keeps everything else** — including the rule that a
  *missing* `mentions` array means "not a note". That is a privacy decision, and it was left intact.

## Found while implementing

**Splitting `submit()` was necessary, not tidying — and a bug in itself.** The language-mismatch
dialog's "Post as X" called `send()` directly. Adding the PKM check to `submit()` would have meant
a post that tripped *both* warnings silently skipped the second one. `submit()` now ends by calling
`finishSubmit()`, and `confirmLanguageAndSend()` resumes there rather than at `send()`.

**Two services now scan `/accounts/:id/statuses` on `/write`** — `DraftSources` looking for
post-to-self *drafts*, `PkmSource` looking for tagged *notes*. They want different age windows (30
vs 180 days) so merging them would have meant one of the two lying. The cost is one duplicated
request on page entry; specs use a `flushStatusScans()` helper because `expectOne` is wrong here by
construction. **Worth revisiting** if a third consumer appears — at that point a shared, cached
own-statuses reader earns its keep.

**An empty word list has to survive the round trip.** "Switched off" and "never configured" are
different states, and normalizing on read would have collapsed them — a user who cleared `#CAL`
would find it back the next morning. `loadPkmVocabulary` returns early only when the key is
*absent*; a present-but-empty list is honoured, and the settings page says which kinds are off.

**`ClientPrefs` persists via a constructor effect**, so the explicit `persist()` calls in the first
draft of the vocabulary setters were both redundant and reaching into a private method. Removed.

**A settings page was the right home, not `blue-controls.html`.** That cluster is a column of
switches; this is three text fields, an explanation of the matching rules, and a live "these kinds
are off" warning. It also had to be anonymous-capable, which the posting page (server-backed via
`verifyCredentials`) is not.

## Verification

- `npm run lint`, `npm run format:check` — pass.
- `npm run test:ci` — **3562 tests pass, 0 fail** (62 added this sprint). Manifest updated.
- `npm run build`, `npm run build:mockingbird` — pass. Only the two pre-existing budget warnings.

## Carried forward

- **Not smoke-tested against a live account.** Two specific unknowns: whether a real
  `/accounts/:id/statuses` history produces false positives for `isSelfNote`, and whether the
  3-page scan is fast enough on a prolific account. Check `/observability` after a real run.
- **`#CAL` is recognized and nothing more** — no date parsing, no calendar. As scoped.
- **The self-post variant of "Save as to-do" is not built.** The menu action is local-only; making
  a note that follows you between devices is still a manual `direct` post.
- **The duplicated own-statuses scan**, above.
- **The notes list view was never extracted into a component**, contrary to S2.6 — see the note
  there. The `pkm/` model boundary is clean; the markup lives in `write-page.html`. Extracting it
  is a prerequisite for mounting the list at `/pkm`, and worth doing alongside sprint 4's board,
  which has the same requirement for the same reason.
