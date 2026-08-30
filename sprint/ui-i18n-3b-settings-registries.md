# i18n Sprint 3b — The rest of Settings, and the registry pattern

Status: **PARTIAL** (2026-08-30) — registries done, 7 page directories remain.
Depends on: [[ui-i18n-3-settings]]

## What shipped

**Both blocking registries, plus the confirm dialog:**

- `src/app/feature-flags.ts` — 46 strings; entries now hold `labelKey` / `descriptionKey`.
- `src/app/bulk-actions.ts` — 47 strings; `labelKey`/`blurbKey`/`titleKey`/`effectKeys`/
  `confirmLabelKey`/`unitKey`.
- `bulk-actions-dialog` + `bulk-progress` — the confirm screen's own 15 sentences and its
  template prose.
- `pages/settings/feature-flags`, `pages/settings/bulk-actions`.

**23 migrated directories, 546 keys, full suite green (5576/5576).**

## The registry pattern, settled

Both open questions from the plan are answered:

1. **Declarations live beside the registry**, not beside each consumer — one place, and a new
   entry needs one comment line next to the data it describes.
2. **`effects` arrays get one key per item** (`bulk.reblogsOff.effect1`…), because each bullet is
   an independent sentence a locale must be free to reorder or merge.

Keys are derived from the entry `id`, camelCased: `connector-mastodon` → `flags.connectorMastodon`.
Hyphens are not legal in a key (see below).

## Two bugs found in shipping code

- **`bulk-actions-dialog` did `.replace('this list', 'this collection')`** on the finished dialog
  title. That is invisible string surgery on display text: once the title is German the substring
  is absent, the replace silently does nothing, and the dialog says "list" over a collection in
  every locale but English — the exact "small lie that makes a confirmation dialog untrustworthy"
  its own comment warns about. Titles now carry `{{source}}` and the noun is passed in.
- **The extractor silently dropped 40 declarations** whose keys contained hyphens. `en.json`
  looked plausible; the only symptom would have been a flag list rendering nothing. A malformed
  key is now a hard error, and the fix immediately caught two more real problems: a key whose
  English legitimately begins with `:` and numeric segments like `uses.5`.

## New: do-not-translate

Boss's call (2026-08-30): **the four public CORS proxies are on the chopping block, so do not
translate them.** A key marked `"translate": false` in `en.context.json` is skipped by
`i18n-todo` and excluded from the coverage denominator, while still rendering and still being
checked. Translating doomed strings would spend work across 30 locales and leave an orphan in
every one when they go. The eight `flags.proxy{Allorigins,Corssh,Corsfix,Corslol}.*` keys carry it;
`proxyMawkingbirdPlus` and the self-hosted proxy are untouched.

## Remaining, measured in strings rather than lines

Line count turned out to be a bad proxy for work — `import-export` is 1454 lines but 151 strings,
while `connections` is a 131-line template that fans out into 13 connector sub-pages:

| Directory | Strings |
|---|---|
| rss | 26 |
| config | 52 |
| i18n | 53 |
| writing | 57 |
| blue | 91 |
| mawkingbird-plus | 108 |
| import-export | 151 |
| **connections** | **455** (twitter 75, hugo 66, blogger 43, doctor 41, …) |

`connections` is 46% of the remaining Settings work on its own and is really 13 pages sharing a
directory name; it deserves to be split out rather than treated as one item.

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

**Registry-backed:** `feature-flags` ✅, `bulk-actions` ✅ — both done. `connections` and
`writing` remain (see the string table above; `writing` needs `publish-wizard.ts`, shared with
`/write`).

**Plain page work, remaining:** `rss`, `i18n`, `config`, `blue`, `mawkingbird-plus`,
`import-export`.

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
