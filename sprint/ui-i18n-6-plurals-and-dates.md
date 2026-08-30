# i18n Sprint 6 — Plurals, dates, numbers

Status: PLANNED
Depends on: [[ui-i18n-5-longtail]]

## Goal

Make counted and time-based strings grammatical in every language, and stop hardcoding English
date and number formatting.

Deferred to here on purpose. Plurals are a *per-string* upgrade, not an architectural one — a
string can move from a flat value to an ICU message without touching the extractor, the gate, or
any other locale. Doing it before the migration would have meant handling two forms of every
string during the churn; doing it after means one pass over a stable set.

## 6a. ICU plurals

Add `@jsverse/transloco-messageformat`.

**Bundle discipline.** It pulls `@messageformat/core` (~40 kB). The build has a 500 kB
initial-bundle warning and a 1 MB error budget, and the app is heavily code-split (main chunk is
40 kB). Load the plural engine **with the locale chunk**, not eagerly — a reader who never changes
language should not pay for a formatter they do not use. Verify against the budget before landing;
if it lands in the initial chunk, that is a regression to fix, not to accept.

Counted strings become ICU messages:

```json
"feed.boosts": "{n, plural, one {# boost} other {# boosts}}"
```

```json
"feed.boosts": "{n, plural, one {# репост} few {# репоста} many {# репостов} other {# репоста}}"
```

Russian is the reason this cannot be faked with a ternary. English has 2 plural categories,
Russian has 6, Japanese has 1, Icelandic and Finnish each have their own rules. Any
`n === 1 ? x : y` in the codebase is a latent bug in most of the world's languages.

**Find them:** sweep for existing English ternary pluralization. `human-time.pipe.ts` has three
(`seconds`, `minutes`, `hours`); there will be more around counts, selections and results. Each
becomes an ICU message.

`check-i18n.mjs` gains a rule: **a translation using ICU plural syntax must supply every plural
category its language requires** (from CLDR). A Russian file with only `one`/`other` is incomplete
in a way that renders wrong for 2-4 items — a bug no English reader can see. Fatal.

Extend the `translate-ui` skill with plural guidance and each language's categories.

## 6b. `Intl` for dates, times, numbers

`human-time.pipe.ts` hardcodes English: `'yesterday'`, `` `${minutes} minutes ago` ``, and
`toLocaleDateString([], …)` with an empty locale array (which uses the *browser* locale, not the
app's — so a forced locale is ignored today).

Rewrite on `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat`, both fed the **active UI locale**:

- Relative times come from `Intl.RelativeTimeFormat`, which removes the hand-rolled singular/plural
  logic entirely and is correct in every locale for free.
- `yesterday` comes from `RelativeTimeFormat`'s `numeric: 'auto'` mode.
- Absolute dates come from `Intl.DateTimeFormat` with the app locale — month abbreviations and
  field order (`3 Mar` vs `Mar 3` vs `3月3日`) are locale-dependent.

The pipe is `pure: false` and called once per timestamp in every feed. **Cache formatter instances
per locale** — constructing an `Intl` formatter is expensive and doing it per post per render
would be a visible performance regression in a long feed.

Sweep for other locale-blind formatting: `DatePipe` with hardcoded patterns (`app-footer` uses
`'yyyy-MM-dd HH:mm'` for build time — arguably fine as a technical timestamp, decide explicitly),
`toLocaleDateString`/`toLocaleTimeString` with empty locales, and number formatting in analytics
and counts. `human-count.pipe.ts` likely abbreviates (`1.2k`) in an English-specific way.

## 6c. RTL — decide, do not drift

None of the day-one eight are RTL, but Arabic and Hebrew are already named in
`language-detect.ts`'s `LangCode` union, so they are plausibly on the 60-language list.

**Make the call in this sprint and write it down.** Either:

- **Commit** — add `dir` handling driven by the locale, and audit CSS for physical properties
  (`margin-left`, `text-align: left`, absolute positioning) that need logical equivalents; or
- **Defer explicitly** — state that RTL locales are out of scope until a dedicated sprint, and do
  not ship Arabic or Hebrew until it exists.

The failure mode to avoid is shipping Arabic into an LTR-only layout because nobody decided. A
half-RTL app is worse than an English one.

## Done when

- [ ] Every counted string is an ICU message; no English plural ternaries remain in migrated code.
- [ ] `check-i18n` fails a Russian file missing `few`/`many`.
- [ ] `human-time.pipe.ts` uses `Intl`, honours the forced locale, and caches formatters.
- [ ] Initial bundle stays inside budget; the plural engine is in the locale chunk.
- [ ] `translate-ui` skill documents plural categories per language.
- [ ] RTL decision recorded in [[ui-i18n-0-overview]].
