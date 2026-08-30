# i18n Sprint 3 — Migrate Settings

Status: **PARTIAL** (2026-08-30) — 17 of 27 settings directories migrated, 372 keys total.
Remaining work moved to [[ui-i18n-3b-settings-registries]].

## What shipped

Migrated and in `MIGRATED`: `anonymous`, `development`, `follows`, `appearance`, `invites`,
`accounts`, `notifications`, `deletion`, `spotlight`, `account`, `storage`, `profile`, `server`,
`privacy`, `content`, `filters`, `account-list`.

Full suite green throughout (5576/5576), including every pre-existing English-text assertion.

## What did not ship, and why

Five directories were left deliberately, all for the same structural reason: **their display text
lives in a registry outside `pages/settings/`**, so migrating the page without the registry would
leave the screen half-translated, and migrating the registry pulls in files that other sprints own.

| Directory | Registry | Why deferred |
|---|---|---|
| `feature-flags` | `src/app/feature-flags.ts` (47 strings) | Operator-facing; registry is shared |
| `bulk-actions` | bulk action registry | Same pattern |
| `connections` | `connection-catalog.ts` (32 entries) | Registry shared with every connector sub-page |
| `writing` | `publish-wizard.ts` (`stepTitle`) | Shared with `/write`, which is [[ui-i18n-5-longtail]] |
| `rss`, `i18n`, `config`, `blue`, `mawkingbird-plus`, `import-export` | — | Simply not reached; no blocker |

The boss's scope call (2026-08-30) was **user-facing pages first, defer the operator pages**.
`feature-flags` and `bulk-actions` were deferred on that instruction; `connections` and `writing`
were then found to have the same registry shape and were deferred to match rather than shipped
half-done.

## Decisions worth keeping

- **Option lists become keys, not English.** `{ days: 365, label: '1 year' }` became
  `{ days: 365, key: 'settings.anonymous.age.years1' }`. "1 year" and "2 years" differ by
  grammatical number, and Russian inflects "5 years" differently again — one key per option lets
  each locale write each one correctly instead of the app composing a number with a noun.
  `settings-server` reuses the `settings.anonymous.age.*` keys rather than duplicating them: it is
  the same control rendered twice.
- **No sentence is built by concatenation.** `account-list` had `'Also ' + otherWord` and
  `'Convert to ' + otherWord`. Its own code comment already noted English needed "muteed" spelled
  out by hand; every other language is worse. Those getters now return whole keys per direction
  (`otherAlsoKey`, `otherConvertKey`, …).
- **A spec that reached into a renamed internal was rewritten to assert on rendered text**
  (`settings-account-list.spec.ts`), which is what it meant to test anyway.
Depends on: [[ui-i18n-2-extraction]]

## Goal

Move the entire `pages/settings/` tree onto translation keys, and grow the `check-i18n` `MIGRATED`
allowlist to cover it.

## Why Settings first

It is the best possible shakedown surface, for four reasons:

1. **Highest text density in the app.** ~25 sub-pages of labels, hints and explanatory prose —
   including `settings-import-export.html` at 1454 lines, the largest template in the codebase.
   If the key convention from [[ui-i18n-1-foundation]] survives Settings, it survives anything.
2. **Self-contained.** Settings pages are leaves. Migrating them cannot break the feed, compose, or
   the shell, so a mistake is contained and obvious.
3. **It already has an i18n page.** `pages/settings/i18n/` exists and owns the language prefs;
   the UI-language control belongs there too, alongside the footer picker.
4. **Rich in exactly the hard cases** — hint paragraphs with embedded prose, `aria-label`s, button
   labels with tight budgets, and validation messages.

## Work

Migrate directory by directory, adding each to `MIGRATED` as it lands. Roughly in this order,
smallest first so the convention is proven before the 1454-line file:

`appearance` → `content` → `privacy` → `notifications` → `writing` → `filters` → `account` →
`connections` → `rss` → `storage` → `development` → `feature-flags` → `i18n` → `server` →
`invites` → `mawkingbird-plus` → `import-export`

For each: extract text to keys, add context entries for glossary-bearing and ambiguous strings,
run `make i18n-extract`, confirm `check:i18n` passes with the directory added to `MIGRATED`.

**Do not translate** anything the app did not write — server-supplied error text, instance
metadata, generated starter-kit or API-doc content. Per [[ui-i18n-0-overview]], text from elsewhere
stays where it came from.

## The UI-language control in Settings

`settings-i18n.html:325` currently renders `Interface language: {{ name(uiLanguage) }}` as
read-only text. Turn it into the real control — the same component as the footer picker, or a
shared underlying service with a settings-shaped presentation.

The footer picker stays. Two entry points is correct here: the footer is the discoverable one for
a visitor who lands on the wrong language, Settings is where someone goes deliberately. They must
share state, not duplicate it.

While only `en` ships, keep the read-only text and hide the control, matching the footer's rule.

## Watch for

- **`blue-controls.html`** carries the three entries in `check-terminology.mjs`'s `ALLOWED` array
  (naming the post/tweet/florp vocabularies themselves). Those strings name vocabularies rather
  than using them, and terminology is English-only per [[ui-i18n-0-overview]]. Mark them `dnt` in
  context and leave the terminology exemption intact.
- **`settings-import-export`** describes the export profiles from `storage-registry.ts`
  (`shareable` / `personal`, `secret` / `private` / `content` / `setting` / `cache`). These are
  precise security terms where a loose translation could mislead someone into publishing private
  data to a public gist. Every one needs a careful `desc`, and `tone: warning` where it warns.
- **Long hint paragraphs** are where machine translation drifts most. They deserve `desc` entries
  more than button labels do.

## Done when

- [ ] Every `pages/settings/` directory is in `MIGRATED` and `check:i18n` passes.
- [ ] Existing settings specs pass unchanged.
- [ ] The UI-language control works from both Settings and the footer, sharing one state.
- [ ] Context entries exist for every export-profile and security-sensitive string.
