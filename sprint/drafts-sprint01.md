# Drafts — Sprint 1: one drafts list, four kinds

Status: COMPLETE (implemented and verified 2026-07-27)

Epic: **Fancy draft support**. Three sprints:

1. **This sprint** — visibility QoL fix, cached posting default, unified draft model,
   merged `/drafts` list that reads all four kinds. No conversions, no gating.
2. `drafts-sprint02.md` — the conversion matrix (→ Paste, → Local, → Schedule, Edit for post).
3. `drafts-sprint03.md` — "thoughtful posting" hard gate.

Standing constraints unchanged: Mockingbird target, `ui/` only, must work unchanged against
mastodon.social, client prefs live in `ClientPrefs`/localStorage, no `ad-*` class names.

## Product premise

Mastodon has no drafts API, so every client invents drafts badly. The folk recipe on
mastodon.social is genuinely awful:

> Set visibility to mentioned-people-only, mention nobody, publish. To edit, find it in Direct
> Messages, click ⋯ → Delete & re-draft, fix the visibility, publish for real.

Mockingbird's position is that a draft is a *concept*, not a storage location. Four different
mechanisms can hold an unpublished post, each with different durability, privacy, and
cross-device behavior — and the user should see all four in one place:

| Kind | Badge | Where it lives | Survives device change | Private |
| --- | --- | --- | --- | --- |
| Local | 💾 | `localStorage` (`mockingbird_drafts`) | no | yes |
| Parked schedule | ⏳ | server `/api/v1/scheduled_statuses`, >10y out | yes | yes |
| Post to self | 🔒 | server, `direct` visibility, no mentions | yes | server-admin-visible |
| Paste | 📋 | external paste service | yes (via link) | no (public/unlisted) |

This sprint makes all four *visible and legible* in one list. Moving between them is Sprint 2.

## What the code audit found

### The paste/visibility QoL bug is real and one-directional

`compose.ts:599-624`. `onTargetChange('paste')` and `onPasteProviderChange()` both clamp:

```ts
if (!provider.visibilities.includes(this.visibility() as 'public' | 'unlisted')) {
  this.visibility.set(provider.visibilities[0] ?? 'unlisted');
}
```

Nothing ever restores it. Switching Fedi → Paste → Fedi leaves the composer on `unlisted`
regardless of what the user picked. `onPasteExpiryChange()` (line 636) additionally forces
`unlisted` for burn-after-reading, with the same one-way problem.

### There is no cached posting default

`source.privacy` is read in exactly one place — `settings-posting.ts:22` — and thrown away when
that settings page is destroyed. The composer hardcodes `visibility = signal<string>('public')`
(`compose.ts:297`). "Restore the user default" therefore requires somewhere to keep it.
`ClientPrefs` is the right home: it is already the client-side prefs blob, already account-scopes
per-account values via `scopedKey()`, and works for anonymous sessions (where there is no
`source.privacy` at all and the answer is simply `public`).

### The drafts page already has two of the four kinds, side by side

`drafts-page.ts` holds `drafts` (local) and `scheduled` (server), rendered as two independent
sections with no shared row shape, no sort between them, and no notion of kind. Adding two more
sources to that structure would produce four disconnected lists.

### Self-posts are reachable but not identified

`/conversations` renders direct-visibility threads. Nothing anywhere tests
`mentions.length === 0`, which is the entire signal that separates "note to self" from "DM to a
person". `api.ts` has the conversations endpoint; no self-post query exists.

### Paste history is a separate store with a separate shape

`PasteHistory.records` (`paste-history.ts`) holds `PasteRecord` — `title`/`content`/`language`/
`expiry`/`visibility` + `slug`/`url`/`rawUrl`/`editKey` + `createdAt`. It has no overlap with
`Draft`'s `segments`/`spoilerText`/`poll` shape. The merged list needs an adapter, not a schema
merge — `PasteHistory` keeps owning its records and its quota-eviction behavior.

## Goal

`/drafts` shows every unpublished post the user has, from all four mechanisms, in one
time-sorted list with kind badges and filter chips — and switching the composer to Paste and back
no longer silently downgrades the post's visibility.

## Stories

### S1.1 — Restore composer visibility when leaving Paste

- Stash the visibility in effect immediately before the first paste-driven clamp.
- Restore it verbatim when the target leaves `paste` (or when a provider/expiry change makes the
  stashed value legal again).
- If nothing was stashed for this composer instance, fall back to the cached posting default, then
  `public`.
- Clear the stash when the user changes visibility *by hand* while on Paste — an explicit choice
  outranks a remembered one.
- Apply the same restore to the burn-expiry clamp in `onPasteExpiryChange()`.

Acceptance:

- `private` → Paste → Fedi restores `private`.
- `public` → Paste (clamped `unlisted`) → user picks `public` on Paste → Fedi stays `public`.
- Burn expiry → non-burn expiry restores the pre-burn visibility.
- A composer that never touched Paste is unaffected.
- Anonymous compose (paste-only default target, `compose.ts:498`) does not crash on a missing default.

### S1.2 — Cache the account posting default

- Add `defaultVisibility` to `ClientPrefs`, account-scoped via `scopedKey()`.
- Populate it from `source.privacy` on `verifyCredentials()` — the app already calls this at
  login; do not add a new request on the composer's hot path.
- Have `settings-posting.ts` write through to the cache when the user saves, so the composer
  reflects a changed default without a reload.
- Seed the composer's initial visibility from the cache for top-level composes, keeping explicit
  `initialVisibility` inputs (e.g. `direct` for conversation replies) authoritative.
- Anonymous sessions resolve to `public` with no request.

Acceptance:

- Setting Posting → default to "Followers only" makes the next new compose open on `private`.
- A reply seeded with `initialVisibility="direct"` still opens on `direct`.
- No extra HTTP request is issued when opening the composer.
- The cached value does not leak between accounts.

### S1.3 — A unified draft view model

- Add a `DraftItem` view model (kind, id, timestamp, preview text, badges, source-specific payload)
  and a resolver that produces one sorted list from four sources.
- Local drafts adapt from `Drafts.drafts()` unchanged — no storage migration.
- Pastes adapt from `PasteHistory.records()` — `PasteHistory` keeps owning persistence.
- Parked schedules: server scheduled statuses whose `scheduled_at` is more than 10 years out.
- Self drafts: the account's own statuses with `visibility === 'direct'`, `mentions.length === 0`,
  created within the last 30 days.
- Deliberately **no linkage** between kinds: a converted item is an independent copy (Sprint 2
  decision). The view model has no cross-kind identity and must not try to deduplicate.
- Failure of one source degrades that source only, with a named warning — a scheduled-statuses
  500 must never hide local drafts.

Acceptance:

- A user with items of all four kinds sees one list sorted newest-first across kinds.
- Anonymous sessions show local drafts and pastes and issue no authenticated request.
- A self-DM *with* a mention never appears.
- A self-post 31 days old never appears.
- A schedule 9 years out never appears as a draft.
- One failing source renders a warning and the other three still render.

### S1.4 — The merged `/drafts` page

- Replace the two-section layout with: filter chips (All / 💾 Local / ⏳ Sched / 🔒 Self / 📋 Paste),
  the merged list, then a separate **Scheduled (real, upcoming)** section for schedules under the
  10-year threshold, which keeps its existing cancel action.
- One row shape for all kinds: badge, relative time, preview, per-kind actions.
- This sprint's actions are the ones that already exist per kind — Sprint 2 adds conversions. Every
  row gets "Remove from drafts" with kind-appropriate semantics and confirmation copy:
  local removes from storage; parked schedule cancels server-side; self draft deletes the status;
  paste routes to the existing `/pastes` delete/forget distinction rather than duplicating it.
- Chip counts reflect what is actually loaded, and a chip with zero items stays visible and
  disabled rather than vanishing.
- Empty state explains the four mechanisms in one sentence each.

Acceptance:

- Chips filter without refetching.
- Destructive actions are confirmed, and the confirm copy names what is actually destroyed
  (browser storage vs. a server post vs. an external paste).
- Near-future scheduled posts are visibly *not* drafts.
- Keyboard focus order and `aria-live` behavior on the list survive filtering.

### S1.5 — Coverage

- `compose.spec.ts`: the visibility stash/restore matrix from S1.1, including hand-edit override
  and burn expiry.
- `client-prefs.spec.ts`: default-visibility caching, account scoping, anonymous fallback.
- Draft-resolver specs: the self-draft predicate (mentions, age, authorship), the 10-year
  threshold boundary, per-source failure isolation, cross-kind sort order.
- `drafts-page.spec.ts`: chip filtering, per-kind action wiring, anonymous mode issuing no
  authenticated request.
- Note for whoever writes these: specs share one jsdom realm (`isolate: false`), so any global
  mutated here leaks into the next file — and `window.location` needs the `stubLocation` helper.

## Suggested delivery order

1. S1.2 (cache) then S1.1 (restore) — the restore's fallback depends on the cache.
2. S1.3 view model with specs, against the existing page.
3. S1.4 page rewrite.
4. Full lint/test/build, then manual smoke against mastodon.social with a real parked schedule and
   a real self-post.

## Sprint exit criteria

- Paste round-trip no longer changes the user's visibility.
- All four kinds appear in one list with working filters.
- No storage migration was required; `Draft` and `PasteRecord` shapes are unchanged.
- No conversion actions and no compose gating shipped (Sprints 2 and 3).
- `npm run format:check`, `npm run lint`, `npm test -- --no-watch`, `npm run build`, and
  `npm run build:mockingbird` pass.

## Delivered

- `ClientPrefs.defaultVisibility` mirrors the account's `source.privacy` in an account-scoped
  localStorage key, populated through `Auth.setAccount()` (the single funnel every login, boot, and
  account switch already passes through) and written through by Settings → Posting. No new request
  is issued on the composer's path.
- The composer stashes the visibility a paste clamp overwrites and restores it on the way back out,
  falling back to the cached default. A hand-picked visibility clears the stash, so an explicit
  choice always outranks a remembered one. The burn-expiry clamp restores the same way.
- `initialVisibility` now defaults to `''` ("no caller opinion") so a top-level compose opens on the
  account default. The two callers that pass a real value (conversation replies, status-card
  replies) are unaffected.
- `draft-items.ts` holds the pure view model — the four adapters plus the `isParkedSchedule` and
  `isSelfDraft` predicates. `draft-sources.ts` loads the two server-backed sources with independent
  failure and merges all four.
- `/drafts` rewritten: filter chips with counts, one row shape across kinds, per-kind removal with
  confirm copy naming the real consequence, and a separate section for genuinely upcoming scheduled
  posts.

## Found while implementing

**A second instance of the reported bug, on the draft-restore path.** `applySnapshot` restored a
draft's visibility and then called `onPasteProviderChange`, which clamped unconditionally — so a
fedi draft saved as `private` had always come back as `unlisted`. The clamp is now gated on Paste
actually being the live target, which fixes both. Not in the original scope; it is the same defect
and the fix is the same line.

**`npm run format` rewrites the entire repo on a Windows checkout.** `.gitattributes` sets
`* text=auto` and `core.autocrlf=true`, so the working tree is CRLF, while Prettier's default
`endOfLine: "lf"` considers every one of those files unformatted. Running `npm run format` converted
~580 files to LF; running `format:check` fails on this checkout regardless of what you changed. The
whole rewrite was reverted — the working tree holds only this sprint's files. Anyone verifying on
Windows should scope Prettier to the files they touched rather than trusting `format:check`, and
setting `endOfLine: "auto"` in `.prettierrc` would make the repo script usable here. Left alone as
out of scope.

## Verification

- `npm run lint` — pass.
- `npm run test:ci` — pass (170 files, 1439 tests).
- `npm run build` — pass.
- `npm run build:mockingbird` — pass.
- `npx prettier --check` scoped to this sprint's files — pass. Repo-wide `format:check` fails on
  untouched files for the line-ending reason above.
- Not manually smoke-tested against a live mastodon.social account with a real parked schedule or
  self-post; the self-draft and parked-schedule paths are covered by unit tests only.

## Deferred

- Conversions between kinds (Sprint 2).
- Thoughtful posting (Sprint 3).
- Third-party schedule providers — out of scope for the epic.
- Any client-side scheduler beyond the existing 30-second undo-send — out of scope for the epic.
- Cross-device sync of local drafts.
