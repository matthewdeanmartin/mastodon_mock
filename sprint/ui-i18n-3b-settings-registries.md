# i18n Sprint 3b — The rest of Settings, and the registry pattern

Status: PLANNED
Depends on: [[ui-i18n-3-settings]]

## Goal

Finish the ten settings directories [[ui-i18n-3-settings]] did not reach, and settle **how a
registry of display strings gets translated** — a pattern that recurs well beyond Settings.

## The registry problem

Five of the remaining directories render their text from a data structure rather than a template:

| Registry | Feeds | Strings |
|---|---|---|
| `src/app/feature-flags.ts` | `settings/feature-flags` | 23 labels + 24 descriptions |
| `connections/connection-catalog.ts` | `settings/connections` + every connector sub-page | ~32 entries (label, pitch, enables) |
| `src/app/publish-wizard.ts` (`stepTitle`) | `settings/writing` **and** `/write` | 4 step titles |
| bulk action registry | `settings/bulk-actions` + `account-list` amnesty | labels + blurbs |

Migrating the page without the registry leaves the screen visibly half-translated — headings in
German, the list of connectors in English. Migrating the registry reaches files that
[[ui-i18n-5-longtail]] owns (`/write` renders `stepTitle` too). Sprint 3 deferred all of them
rather than land that inconsistency; this sprint does them together.

**The pattern to establish** (already proven on the small cases in Sprint 3): a registry entry
holds a **key**, not English, and the English lives in an `// i18n` declaration beside it.
`settings-anonymous.ts` and `settings-filter-edit.ts` both work this way now, and
`check-i18n.mjs` already recognises a bare `key: 'a.b'` property as a use, so an indirect key does
not read as an orphan.

Two things to decide once, here, and then apply everywhere:

1. **Where the declarations live** for a registry shared by several pages — beside the registry
   (one place, far from the template) or beside each consumer (duplicated). Beside the registry is
   almost certainly right; say so explicitly so it is not re-litigated per file.
2. **Whether `enables` arrays** (`connection-catalog`'s per-entry feature lists) become one key
   each or one key per array. Per item is more reusable; per array reads better.

## Directories

**Registry-backed** (do the registry first, then the page):
`feature-flags`, `bulk-actions`, `connections`, `writing`

**Plain, just not reached** (no blocker, straight template work):
`rss` (267 lines), `i18n` (350), `config` (358), `blue` (707), `mawkingbird-plus` (819),
`import-export` (1454)

## Watch for

- **`import-export`** describes the export profiles from `storage-registry.ts` (`shareable` /
  `personal`; `secret` / `private` / `content` / `setting` / `cache`) — the rules deciding what
  lands in a **public gist**. The boss's call (2026-08-30): translate them, but every
  security-relevant string gets a context entry with `tone: warning` and the consequence spelled
  out, so a translator cannot render it casually. A German reader given an English warning about
  publishing private data is worse served than one given a careful translation.
- **`blue/blue-controls.html`** holds the three entries in `check-terminology.mjs`'s `ALLOWED`
  array, naming the post/tweet/florp vocabularies themselves. Terminology is **English-only by
  decree** ([[ui-i18n-0-overview]]) — mark them `dnt` and leave the terminology exemption intact.
- **`mawkingbird-plus`** is billing copy (14 price/subscription mentions). Amounts and currency
  are data, not interface: never translate a number, and check whether currency formatting should
  follow the UI locale or stay as billed.
- **`settings/i18n`** is where the read-only "Interface language" text at `settings-i18n.html:325`
  becomes the real control, sharing state with the footer picker. See [[ui-i18n-1-foundation]].

## Done when

- [ ] All 27 settings directories are in `MIGRATED` and `npm run check` passes.
- [ ] The registry pattern is documented once and applied to all four registries.
- [ ] `publish-wizard.ts` is migrated, and `/write` still renders correctly (it shares `stepTitle`).
- [ ] Export-profile strings all carry `tone: warning` context entries.
- [ ] Full suite green with no changes to pre-existing English-text assertions.
