# Drafts — Sprint 2: the conversion matrix

Status: COMPLETE (implemented and verified 2026-07-27)

Depends on `drafts-sprint01.md` (unified view model + merged `/drafts` page) — **complete**.

## What Sprint 1 leaves you

- `pages/drafts/draft-items.ts` — `DraftItem` (key/kind/id/at/preview/visibility/badges/source),
  the four adapters, and the `isParkedSchedule` / `isSelfDraft` predicates. All pure, all tested.
  `DraftSource` is a discriminated union carrying the underlying `Draft` / `ScheduledStatus` /
  `Status` / `PasteRecord`, so every conversion has its real source record already in hand.
- `pages/drafts/draft-sources.ts` — `DraftSources`, a root service with `items()`, `counts()`,
  `upcomingScheduled()`, `load()`, and `forgetScheduled()` / `forgetSelf()` for dropping a row after
  a successful server-side removal. Add conversion-side invalidation here, not in the component.
- `pages/drafts/drafts-page.ts` — chips, `visible()`, and `askRemove` / `confirmRemove` with
  per-kind confirm copy in the `removalCopy()` helper at the bottom of the file. The row already has
  an actions slot; today it holds Continue (local only) and 🗑.
- `ClientPrefs.defaultVisibility` — use this for the visibility a self draft arrives on in S2.1,
  rather than letting `direct` ride along into the composer.

Note that `open()` currently handles only `kind === 'local'` (it routes to `/home` with a `draft`
query param). S2.1 is where the other three kinds get their route in.

## Product premise

Sprint 1 makes the four draft mechanisms *visible*. This sprint makes them *fluid*: any draft can
become any other kind, and any draft can be loaded into the composer to become a real post.

The governing rule, stated by the boss and applied uniformly: **conversion never destroys the
source.** Turning a paste into a draft leaves the paste at its provider. Editing a paste into a
post leaves the paste alone. Removal is always a separate, explicit, confirmed action.

The second rule, also decided: **conversions produce independent copies.** There is no linkage,
no backlink chip, no sync, no cross-kind deduplication. A converted item is a new artifact whose
only relationship to its source is that a human remembers making it. This keeps the model
comprehensible at the cost of letting the list show near-duplicates — an acceptable trade, since
the alternative is a sync semantics nobody asked for.

The one exception to "never destroys the source" is publishing a **self draft** for real, where
the folk recipe is inherently destructive (delete & re-draft) and leaving the copy behind
accumulates junk in the DM tab. There, publishing succeeds first, and *then* a confirm offers to
delete the private copy with delete pre-selected. A failed publish can never lose text.

## The matrix

| From ↓ / To → | Local 💾 | Parked schedule ⏳ | Paste 📋 | Real post |
| --- | --- | --- | --- | --- |
| Local 💾 | — | park dialog | provider picker | Edit for post |
| Parked ⏳ | copy out | — | provider picker | Edit for post |
| Self 🔒 | copy out | park dialog | provider picker | Edit for post → offer delete |
| Paste 📋 | copy out | park dialog | — | Edit for post |

"Copy out" is non-destructive in every cell. "Edit for post" loads the content into the composer
with its Post button live and leaves the source in place.

## Row actions: a `<details>` overflow menu

**Decided.** `status-card.html` already carries this exact idiom — `<details class="danger-menu">`
with a `•••` summary and an absolutely-positioned panel — for the same problem (too many per-row
actions to sit inline). Sprint 2 reuses the pattern rather than introducing a menu component:
native disclosure semantics, keyboard and screen-reader behavior for free, no focus-trap code, and
no new dependency.

The row keeps its two most-used actions inline (**Edit for post**, and 🗑 Remove) and moves the
three conversions into the menu. Panel opens *downward* here — unlike the status-card menu, which
opens upward because it sits at the bottom of a card.

## Extraction: one snapshot type, four sources

Every conversion is "read a source into a neutral shape, write that shape somewhere else". Doing
that pairwise is twelve conversions; routing through a single intermediate is four readers and
three writers. The intermediate already exists — `DraftSnapshot` in `drafts.ts` (segments,
spoilerText, sensitive, visibility, poll, target, paste fields).

So: add `toSnapshot(source: DraftSource): DraftSnapshot` to `draft-items.ts` alongside the adapters,
and have every conversion go through it. It is pure, so the whole extraction matrix is unit-testable
without a component or an HTTP mock.

Per-source extraction rules:

- **local** — the `Draft` already *is* a snapshot; pass it through minus `id`/`updatedAt`.
- **scheduled** — `params.text` → segment 0, `params.spoiler_text` → spoilerText,
  `params.visibility` → visibility, `params.poll.options` → poll (expiry and `multiple` are not in
  `ScheduledStatus['params']`, so they fall back to the composer defaults).
- **self** — `stripHtml(content)` → segment 0. **Visibility must not carry `direct` forward**: a
  self draft is `direct` only as a storage trick, and inheriting it would silently publish the real
  post to nobody. It resolves to `ClientPrefs.defaultVisibility` instead. This is the single most
  important line in the sprint.
- **paste** — `content` → segment 0, `title` → spoilerText (matching how the paste badge already
  reads "Title" rather than "CW"), plus `pasteProviderId`/`pasteLanguage`/`pasteExpiry`.

## Stories

### S2.1 — Extraction + Edit for post

- Add `toSnapshot()` with the four extraction rules above.
- `Edit for post` puts the snapshot in the composer with a live Post button and leaves the source
  row exactly where it was.
- Local drafts keep today's behavior (`/home?draft=<id>`), which *consumes* the draft into the
  composer — that is the pre-existing "Continue" contract and Sprint 1 shipped it; do not change it
  here. The other three kinds hand the composer a snapshot without touching the source.
- Mechanism: `Drafts` gains a one-shot handoff slot (a signal the composer drains on seed) so a
  snapshot can cross the route boundary without serializing a whole post into the URL.

Acceptance:

- Each kind lands in the composer with its text, spoiler/title, sensitive flag, and poll intact.
- A self draft never arrives on `direct`.
- After Edit for post, the parked schedule / self post / paste still exists and still lists.
- Navigating away and back does not re-seed a consumed handoff.

### S2.2 — Convert to Paste

- A provider-picker dialog exposing the real `PasteProvider` metadata: provider, language, expiry,
  visibility, and the `immutable` warning for TinyURL. This dialog is where the richness lives,
  because none of it can be inferred from a draft.
- Creates the paste, records it in `PasteHistory`, leaves the source alone.
- Surfaces `PasteHistory.persistError` (the quota path) rather than silently losing the link — the
  existing composer path already does this and the copy should match.
- A failed create leaves the source untouched and reports the provider's own failure.

### S2.3 — Convert to Local

- `Drafts.save(toSnapshot(source))`. Non-destructive for all three non-local kinds.
- Available on local rows only as "Duplicate", if at all — decide during implementation; a local →
  local conversion is not in the matrix and may be noise.

### S2.4 — Convert to Schedule (park)

Dialog defaulting to a fixed far-future park date (~2124) with an editable date field and a line
explaining that >10 years lists as a draft rather than a scheduled post.

**A server that rejects the date is ordinary error handling, not a special case** (boss's call). We
do not probe for a ceiling, clamp speculatively, or maintain a per-instance table of accepted
ranges. The park request goes out optimistically; a 422 surfaces the server's own message with the
date field still populated so the user can pick a nearer one. The draft is never consumed by a
failed park — the source survives a rejection exactly as it survives every other conversion.

### S2.5 — Publishing a self draft, and its one destructive exception

- Edit for post on a self draft publishes a normal post (S2.1 already gave it a sane visibility).
- **After the publish succeeds**, a confirm offers "Delete the private draft copy?" with delete
  pre-selected. Never before: a failed publish must not be able to destroy the only copy.
- Declining leaves the self post exactly where it was, still listed.

### S2.6 — Paste-screen parity

`/pastes` gets "Convert to Draft" (local or park) and "Edit for post", with the same
non-destructive guarantee, reusing `toSnapshot`. Keeps the existing edit/delete/forget actions.

### S2.7 — Coverage

- `toSnapshot` for all four sources, especially the self → non-`direct` visibility rule.
- Every conversion asserts the **source still exists afterwards** — that is the sprint's governing
  rule and it deserves an explicit assertion per cell, not an implicit one.
- Paste creation failure and quota/`persistError`.
- Park rejection: source survives, error surfaces, date field stays populated.
- The self-publish delete confirm, including publish-fails-nothing-deleted.
- Overflow-menu wiring per kind (a paste row offers no "→ Paste", etc.).

## Resolved before starting

- **A rejected far-future `scheduled_at` is ordinary error handling.** No probing, no ceiling table,
  no speculative clamping — see S2.4.

- **Row actions**: reuse the `<details class="danger-menu">` idiom from `status-card.html`. No new
  component.

## Suggested delivery order

1. `toSnapshot` + its specs — pure, and everything else depends on it.
2. The composer handoff slot and Edit for post for the three non-local kinds.
3. The overflow menu and → Local (the cheapest writer, proves the menu wiring).
4. → Paste with the provider dialog.
5. → Schedule with the park dialog and its rejection path.
6. The self-publish delete confirm.
7. `/pastes` parity.

## Sprint exit criteria

- Every cell of the matrix works, and every non-self conversion provably leaves its source intact.
- The one destructive path (self publish → delete copy) only ever runs after a successful publish.
- No linkage, backlink, sync, or cross-kind dedup was introduced.
- `npm run format:check`, `npm run lint`, `npm test -- --no-watch`, `npm run build`, and
  `npm run build:mockingbird` pass.

## Delivered

- `toSnapshot()` in `draft-items.ts` — the single extraction point, with the self-draft visibility
  rule (never `direct`) as its most important line. Pure and fully unit-tested.
- `Drafts.handoff()` / `takeHandoff()` — an in-memory one-shot slot carrying a `DraftHandoff`
  (snapshot plus optional `selfStatusId`) across the route change into the composer. Deliberately
  not persisted; a snapshot that outlived a reload would surface in an unrelated composer later.
- The composer drains the handoff only in the `new` context (`acceptsHandoff()`), so a reply or
  quote box can never swallow a post meant for the main composer.
- `/drafts` rows gained **Edit for post** inline and a `•••` `<details>` menu holding → Local,
  → Paste, and → Schedule, reusing the status-card disclosure idiom.
- Provider-picker dialog (service / language / expiry, with the TinyURL immutability warning) and
  park dialog (editable `datetime-local` defaulting 99 years out).
- Self-publish cleanup: publish first, *then* offer to delete the private copy. Wired only where a
  real `Status` exists — not on a scheduled result, a paste, or a Bluesky post.
- `/pastes` parity: **Edit for post** and **💾 To draft**, both non-destructive.

## Found while implementing

**The self-cleanup hook could not go in `reset()`.** Every publish path calls it, but so does
`saveDraft()`, and so does the *paste* success path — pasting a private note somewhere public is
no reason to delete the private note. It is called explicitly at the two sites where a real fedi
`Status` exists. A scheduled result deliberately does not trigger it: nothing is published yet, so
the private copy is still the live version.

## Verification

- `npm run lint` — pass.
- `npm run test:ci` — pass (170 files, 1461 tests; 22 added this sprint).
- `npm run build` / `npm run build:mockingbird` — pass.
- `npm run format:check` — pass repo-wide, now that `endOfLine: "auto"` is set (see below).
- Still **not** smoke-tested against a live mastodon.social account. Everything here is covered by
  `HttpTestingController` only.

## Also done this sprint (out of band)

`.prettierrc` gained `endOfLine: "auto"`, fixing the Windows CRLF problem recorded in Sprint 1 —
`format:check` was failing on ~580 untouched files on any Windows checkout. Fifteen files with
genuine pre-existing formatting violations were reformatted at the same time, so `format:check` now
passes repo-wide for the first time. (One, `dropbox-session.spec.ts`, needed two Prettier passes to
converge on a nested call chain.)

## Open questions carried into Sprint 3

- Sprints 1 and 2 verified nothing against a live account. The parked-schedule and self-draft paths
  — including whether mastodon.social actually accepts a 99-year `scheduled_at` — have only ever
  been exercised against `HttpTestingController`. The park path handles rejection as ordinary error
  handling, so a refusal is survivable, but nobody has watched it happen.
