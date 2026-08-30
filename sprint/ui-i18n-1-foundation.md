# i18n Sprint 1 — Foundation: wiring, negotiation, the footer picker, and the gate

Status: **COMPLETE** (2026-08-30)

## What actually shipped, where it differs from the plan

- **`UiLocale` does not inject `TranslocoService`.** The plan had one service doing both. In
  practice `KnownLanguages` reads `UiLocale`, and `Api` reads that, so it sits in the dependency
  graph of nearly every service — and ~30 specs call `TestBed.resetTestingModule()` in their own
  `beforeEach`, discarding globally-installed providers. That produced 117 failures of
  `No provider for TRANSLOCO_TRANSPILER` in services with nothing to do with translation. Pushing
  the locale *into* Transloco is now a separate `TranslocoLocaleSync`, wired once at bootstrap
  by `provideI18nForApp()`.
- **The test harness is installed globally**, in `test-setup.ts`'s existing `beforeEach`, rather
  than per-spec. `TestBed.configureTestingModule` is additive, so configuring ahead of each
  spec's own call merges. Verified empirically before building on it: 286 specs configure
  TestBed themselves and none needed editing.
- **No new `storage-registry.ts` entry was needed** — `uiLocale` lives inside the existing
  `mockingbird_client_prefs` blob, already classified `setting`.
- **`ClientPrefs` persists from a constructor effect**, so `choose()` only sets the signal.
Depends on: [[ui-i18n-0-overview]]

## Goal

Stand up the whole i18n mechanism end to end and prove it on **one small surface**, without
translating anything. At the end of this sprint the app still renders 100% English, but:

- strings can come from a dictionary,
- the locale can be **forced** from a visible control,
- a German browser gets German the moment a `de.json` exists,
- and the build fails if a new template hardcodes user-visible text in a migrated directory.

Shipping the mechanism before any translation is deliberate. If the picker and the negotiation
are not provably working first, there is no way to *review* a translation — the maintainer's
browser reports English, so without a forcing control an incorrect Icelandic string is invisible.

## 1a. Dependencies

```
npm i @jsverse/transloco
```

`@jsverse/transloco@8.4.0` declares `@angular/core: >=16`, satisfied by this repo's 21.2.21; a
`--dry-run` install resolves clean with no peer conflicts (+25 packages).

**Do not** add `@jsverse/transloco-messageformat` yet — ICU plurals are [[ui-i18n-6-plurals-and-dates]],
and its `@messageformat/core` dependency is runtime weight that must be loaded *with the locale
chunk*, not eagerly, to stay inside the 500 kB initial-bundle warning budget.

Note for `make security`: Transloco pulls `@jsverse/utils@1.0.0-beta.5` transitively — a beta
package in a production path. It is small and low-risk, but pin it via `package-lock.json` and
mention it in the PR so the audit result is not a surprise.

## 1b. `src/app/i18n/locale.ts` — negotiation and persistence

A root service owning one signal, with the three-tier precedence from the overview.

```ts
export const SUPPORTED_LOCALES = ['en'] as const;  // grows in i18n-7
export const FALLBACK_LOCALE = 'en';
```

Rules, in order:

1. **Stored choice wins forever.** If `ClientPrefs.uiLocale()` is set, use it and stop. Never
   re-run negotiation over an explicit choice — a user who forced English on a German laptop must
   not be flipped back on next visit.
2. **Otherwise negotiate** against `navigator.languages`, in order, matching each entry against
   `SUPPORTED_LOCALES`. Match the bare tag: `de-AT` → `de`, `pt_BR` → `pt`. Reuse the existing
   `bare()` normalizer from `trend-language-filter.ts` rather than writing a second one — that
   file already does exactly this for the known-languages set.
3. **Floor at `en`** when nothing matches.

The negotiated result is **not** persisted. Persisting it would silently freeze a guess into an
explicit choice, so a user who later changes their OS language would be stuck on the old one with
no indication why. Only the picker writes to storage.

### `ClientPrefs.uiLocale`

Add alongside the existing language prefs (`knownLanguages`, `feedLanguages`, `learningLanguages`
at `client-prefs.ts:745+`), following the established pattern exactly: a `signal<string | null>`
defaulting to `null` (meaning "not chosen — negotiate"), included in the persisted prefs interface
around `client-prefs.ts:408`.

**`storage-registry.ts` must gain the key**, or `npm run check:storage` fails the build. Classify
as **`setting`** — it is a UI preference with no personal content, so it belongs in a shareable
"here is my setup" gist:

```ts
{
  base: 'mockingbird_ui_locale',
  storage: 'local',
  suffix: 'none',
  sensitivity: 'setting',
  note: 'Forced UI language, or absent when the browser locale is negotiated.',
}
```

### Feeding `UI_LANGUAGE`

`trend-language-filter.ts:9` currently hardcodes `export const UI_LANGUAGE = 'en'`, and
`KnownLanguages.codes` uses it as the floor of the set of languages the user is assumed to read.
That constant becomes wrong the moment the UI can render in German: a German-speaking reader would
still have English as their only inferred known language.

Replace the constant with a read from the locale service, keeping `KnownLanguages.codes` reactive
(it is already a `computed`, so this composes). `settings-i18n.html:325` renders
`Interface language: {{ name(uiLanguage) }}` and will start telling the truth for free.

Keep a `UI_LANGUAGE` export as a deprecated alias if it keeps the diff small, but the three
`trend-language-filter.spec.ts` references (lines 10, 78, 184) will need updating either way.

## 1c. Transloco config

`src/app/i18n/i18n.config.ts` providing:

- `availableLangs: SUPPORTED_LOCALES`, `defaultLang: FALLBACK_LOCALE`
- **`fallbackLang: 'en'` and `missingHandler: { useFallbackTranslation: true }`** — this is the
  setting that makes the whole "coverage is reported, never enforced" strategy work. A key missing
  from `fi.json` renders the English string rather than the raw key.
- `reRenderOnLangChange: true` — required for the picker to work without a page reload.
- `prodMode` bound to the existing environment/build-flavor helper.
- An HTTP loader fetching `/i18n/{lang}.json` from `public/`.

**Base-href hazard.** The loader URL must respect the deployment's base href. The app ships at
`/_ui/` (FastAPI), `/` (mawkingbird.com), `/canary/`, and assorted subpaths — a hardcoded
`/i18n/de.json` 404s on three of those four. Resolve against `APP_BASE_HREF` / the document base,
the same way other assets do. Getting this wrong fails *only on deployed subpaths* and not in dev,
which is the expensive kind of bug — `check-subpath-deployments.mjs` exists because this class of
error already bit once.

Wire `provideTransloco(...)` into `appConfig.providers` in `app.config.ts`.

## 1d. Test harness — the shared-realm trap

**This is the highest-risk item in the sprint.** `vitest.config.ts` runs with the Angular builder's
`isolate: false`, so all 422 spec files share one jsdom realm — the same condition that produced
the `window.location` bug documented at length in `test-setup.ts`. A Transloco singleton holding
locale state and an async HTTP loader would reproduce that failure shape exactly: a spec that
switches locale leaks German into whichever unrelated spec the runner schedules next in that
worker, failing ~40% of runs and never in isolation.

Two defenses, both required:

1. **`src/app/i18n/i18n.testing.ts`** exports a provider using a **synchronous, in-memory,
   English-only** loader — no HTTP, nothing to await, no `HttpTestingController` expectation for
   every spec that happens to render a translated string. Specs get English immediately on first
   render.
2. **`test-setup.ts` resets the locale to `en` in the existing `beforeEach`**, next to
   `restoreLocation()`, for the same reason and with a comment saying so.

Because the harness resolves keys to English synchronously, **the 279 existing spec assertions
that match visible English text keep passing untouched.** Preserving that is a hard requirement of
this sprint — a foundation that forces a rewrite of a third of the test suite is not a foundation.

The `en.json` used by tests should be the real one, imported directly, so a spec fails if a key it
renders is missing rather than silently showing a key name.

## 1e. The footer locale picker

New component `src/app/locale-picker/`, rendered in `shell/app-footer/app-footer.ts`.

**Placement.** The footer is the agreed home for now. It is rendered by `shell.html:436` as
`<app-app-footer />`, outside the router outlet, so it appears on every routed page and cannot be
hidden by `/write`. Insert the picker into the existing `·`-separated link row — after
"Fail whale", before the keyboard-shortcuts button — using the same `.footer-separator` span the
neighbouring items use. It inherits `--muted` and `12.5px` from `.app-footer` and needs no new
visual weight. The overview notes a top-bar home may be chosen later; nothing here should make
that move harder, so keep the component free of footer-specific styling.

**Behaviour.**

- Renders as a `<select>` of shipped locales, each labelled in **its own language**
  (`Deutsch`, `日本語`, `Suomi`, `Íslenska`, `Русский`) — never in English. Someone who cannot read
  the current UI language must still be able to find their own.
- Includes an explicit **"Automatic (browser)"** option at the top, which clears the stored
  preference and returns to negotiation. Without it, forcing a locale once is irreversible, which
  is a trap for the maintainer more than anyone.
- Changing it sets `ClientPrefs.uiLocale` and calls the Transloco service; with
  `reRenderOnLangChange` the UI re-renders live, no reload.
- The `<select>` needs an accessible name (`aria-label`) since it has no visible `<label>`.
- **Hide the control entirely while only `en` is shipped** (`SUPPORTED_LOCALES.length < 2`). A
  one-option language picker is noise on a crowded footer. It appears by itself in
  [[ui-i18n-7-languages]] when the second locale lands.

Guard the hidden case with a spec, so the control does not accidentally ship visible-but-useless.

## 1f. `scripts/check-i18n.mjs` — the gate

Joins the `check:static` family beside `check-storage-registry.mjs` and `check-terminology.mjs`,
and follows their house style: a Node script (not a vitest spec — the Angular test build has no
Node types or filesystem access), a header comment explaining *why the rule exists*, and a short
`ALLOWED` array with a `why` per entry.

Three rules:

1. **No hardcoded user-visible text** in a template under a migrated directory. Detection can reuse
   `check-terminology.mjs`'s existing logic for what counts as display text — it already
   distinguishes `aria-label` / `title` / `sr-only` / text nodes from API field names, CSS classes,
   route paths and tab keys. **Fatal.**
2. **Every key used in a template or `.ts` exists in `en.json`**, and `en.json` has no orphans.
   **Fatal.** This is what stops a typo'd key rendering as `settings.i18n.titel` in production.
3. **Per-locale coverage is printed, never fatal** — `fi 71%  is 68%  ru 82%`.

### The migration allowlist

Rule 1 applies only to directories listed in a `MIGRATED` array, which starts as just the one
surface from 1g and grows one sprint at a time until [[ui-i18n-5-longtail]] empties its inverse. This
is what makes the retrofit incremental: unmigrated directories are not failures, they are simply
not yet in scope, and the array is a visible ratchet that can only move forward.

Wire into `package.json`: `check:i18n` script, added to the `check:static` chain. Add a `make i18n`
target to `ui/Makefile` per the house rule that every command gets a Make target.

## 1g. First migrated surface

Migrate exactly one small, self-contained component to prove the loop end to end. **`app-footer`
itself** is the right choice: it is small (~10 strings), it is on every page so a regression is
immediately visible, it contains a genuine mix of link text, a `title` attribute and interpolated
build metadata, and it is where the picker lives — so the picker's own surroundings become the
first thing that can be translated.

Hand-write its keys into `en.json` for now; `extract-i18n.mjs` arrives in
[[ui-i18n-2-extraction]] and will regenerate the file from these same templates. Choose the key
naming convention here and document it in the sprint's PR, because every later sprint inherits it:

```
footer.rules            "{host} rules & terms"
footer.source           "Mockingbird source"
footer.reportBug        "Report a bug"
footer.privacy          "Privacy"
footer.failWhale        "Fail whale"
footer.hotkeys          "? for keyboard"
footer.hotkeys.title    "Keyboard shortcuts (or press ? anywhere)"
footer.end              "You reached the end. That's allowed here."
footer.builtAt          "Built {date} UTC"
footer.buildLog         "build log"
localePicker.label      "Interface language"
localePicker.auto       "Automatic (browser)"
```

Convention: `area.element` / `area.element.attribute`, camelCase segments, dotted namespaces
mirroring the directory tree. `.title` and `.aria` suffixes for attribute strings on the same
element.

Do **not** translate the interpolated build commit, host name, or timestamp — those are data, not
interface. `{host}` and `{date}` stay as Transloco params.

## Done when

- [ ] `npm run check` passes, including a new `check:i18n` in `check:static`.
- [ ] The full existing suite passes with **no changes to the 279 English-text assertions**.
- [ ] `make i18n` exists.
- [ ] Setting `navigator.languages = ['de']` in a spec negotiates to `de` when `de` is supported,
      and to `en` when it is not.
- [ ] An explicit stored choice survives a browser-language change (regression test for rule 1).
- [ ] The picker is hidden while only `en` ships, and a spec asserts that.
- [ ] The footer renders entirely from `en.json`; deleting a key from `en.json` fails `check:i18n`
      rather than rendering a raw key name in the browser.
- [ ] `UI_LANGUAGE` reflects the active locale; `settings-i18n` shows it.
- [ ] A locale JSON fetch resolves correctly under a non-root base href (`/canary/`).

## Explicitly not in this sprint

ICU plurals, `Intl` dates, `human-time.pipe.ts`, any non-English JSON file, the extractor, the
context sidecar, the glossary, the translation skill, and any template outside `app-footer`.
