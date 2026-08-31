---
name: migrate-i18n
description: Move one directory's hardcoded interface text into translation keys. Use when asked to migrate, internationalise or i18n a directory under mastodon_mock/ui/src/app, or when adding a directory to check-i18n's MIGRATED list.
---

# Migrate one directory to translation keys

You are making **one directory** translatable. Not the app — one directory. Finish
it completely and leave `npm run check` green.

The goal, stated the way it has to be stated: **a German speaker who reads no
English must be able to use this page.** A feature that is 90% translated is not
usable, because the missing 10% is exactly where they get stuck.

## The loop

```bash
cd mastodon_mock/ui

node scripts/i18n-scan.mjs <template.html>   # every string still hardcoded
# ...write a key map, apply it, declare the English...
npm run i18n:extract                         # regenerate en.json
npm run check:i18n                           # the gate
```

### 1. Scan

```bash
node scripts/i18n-scan.mjs src/app/<dir>/<file>.html
```

Prints `line<TAB>KIND<TAB>"text"`. Three kinds:

- `TEXT` — words between tags.
- `title` / `placeholder` / `aria-label` / `alt` — a static attribute.
- `INTERP` — an English literal inside `{{ }}`, e.g. `busy() ? 'Saving…' : 'Save'`.
  **`check-i18n.mjs` cannot see these.** They survive the gate and render English
  in every locale. Scan output is the only thing that finds them.

Run it on every `.html` in the directory, including subdirectories.

### 2. Handle the cases a key swap cannot fix — **do this first**

Three shapes must be restructured **by hand before** any bulk replacement.
Each renders correctly in English and wrongly in German, so nothing catches
them but you.

**(a) Concatenated sentences.** `'Exporting ' + count() + '…'` and
`'Follow selected (' + n + ')'`. English word order is not universal. Use one
whole key with a parameter:

```html
{{ 'area.exporting' | transloco: { count: exportCount() } }}
```
```ts
// i18n area.exporting: Exporting {{count}}…
```

**(b) Pluralisation by suffix.** `post{{ n === 1 ? '' : 's' }}` glues an `s` on.
German, Finnish and Russian do not pluralise that way. Use a whole-string
`.one`/`.other` pair — the call site then never changes again when sprint 6
adds real ICU categories:

```html
{{
  (row.count === 1 ? 'area.posts.one' : 'area.posts.other')
    | transloco: { count: row.count }
}}
```
```ts
// i18n area.posts.one: {{count}} post
// i18n area.posts.other: {{count}} posts
```

**(c) A count or value left outside its sentence.** `<strong>{{ n }}</strong>`
sitting next to a key is the same bug as (a). Fold it in, using `[innerHTML]`
when the string carries inline markup:

```html
<span [innerHTML]="'area.summary' | transloco: { count: n() }"></span>
```
```ts
// i18n area.summary: <strong>{{count}}</strong> connections are encrypted.
```

Also **never `.replace()` a substring of display text** — once the text is
German the substring is absent, the replace silently no-ops, and the wrong word
ships in every non-English locale.

### 2b. English in TypeScript that no scanner can see

`i18n-scan.mjs` reads templates. It cannot see a string that lives in a class
field, so these leak past a directory that scans clean:

```ts
readonly placeholder = input('What is happening?');   // rendered as the compose box prompt
protected status = signal('Finishing authorization.'); // rendered as page text
this.message.set(warning ?? 'Fetched twice and verified stable.');
const title = feed.title ?? 'Bluesky feed';
```

Grep for them before you call a directory done:

```bash
grep -rnE "input\('[A-Z][a-z]+ [a-z]|signal\('[A-Z][a-z]+ [a-z]|\?\? '[A-Z][a-z]{2,}"   src/app/<dir> --include=*.ts
```

Most become `this.transloco.translate<string>('key')` at the point of use. An
**`input()` default cannot**, because it is evaluated before an injection
context exists. Default it to `''` and resolve in a `computed`, so callers that
pass their own already-translated value are unaffected:

```ts
readonly placeholder = input('');
protected readonly placeholderText = computed(
  () => this.placeholder() || this.transloco.translate<string>('area.placeholder'),
);
```

### 3. Write a key map and apply it

Write a JSON array of `{"text": "...", "key": "..."}`. `text` is the string as
the scanner printed it; matching collapses whitespace, so prose that Prettier
rewrapped still matches. Add `"kind": "TEXT"` or `"kind": "INTERP"` only when the
same words appear as both.

```bash
node scripts/i18n-apply.mjs <template.html> <map.json> --report   # dry run
node scripts/i18n-apply.mjs <template.html> <map.json>            # apply
```

`--report` lists what is unmapped and which map entries matched nothing. **Get
that clean before applying.** The applier rewrites by byte offset, so it does not
drift the way a hand-copied snippet does.

Naming: `area.thing`, dotted **camelCase**, no hyphens (the extractor hard-errors
on them). Prefix by directory — `settings.plus.`, `pages.search.`. Split a
sentence broken by inline markup as `.hint.a` / `.hint.b`, not by inventing
grammar.

### 4. Declare the English

`en.json` is **generated — never hand-edit it.** The English lives in a comment
above the `@Component` decorator:

```ts
// i18n settings.plus.account.signOut: Sign out
```

Add `TranslocoPipe` to the component's `imports:` array **and** its import line.
A component with no `imports:` array needs one added.

Doing only half of this is the single most common way this goes wrong, and the
two halves fail differently: the import without the array entry is a lint error
(`'TranslocoPipe' is defined but never used`), the array entry without the
import is a build error (`NG8004: No pipe found with name 'transloco'`). Check
every component you touched:

```bash
for f in $(grep -rln "| transloco" src/app --include=*.html); do
  ts="${f%.html}.ts"
  [ -f "$ts" ] && grep -q TranslocoPipe "$ts" || echo "MISSING: $ts"
done
```

To translate outside a template — a string built in TypeScript — inject
`TranslocoService` and call `this.transloco.translate<string>(key, params)`.
That injection is safe in a component; it is only `UiLocale` that must never
take it (see Traps).

### 5. Add the directory to the gate

Append the directory (relative to `src/app`) to `MIGRATED` in
`scripts/check-i18n.mjs`. It is a ratchet: it only grows.

### 6. Verify

```bash
npm run i18n:extract
npm run check:i18n     # must print "i18n OK"
npx prettier --write "src/app/<dir>/**/*.{ts,html}"
npx ng lint ui --max-warnings 0
```

Then run the tests. **Run them through the project's own script** —
`npx vitest run <path>` fails with `Need to call TestBed.initTestEnvironment()`
because a subset run skips `test-setup.ts`:

```bash
npm run test:ci
```

## Do not translate

Generated files (`*.generated.ts`), RSS and post content, server error strings,
remote instance metadata, `<code>` samples (a literal `#TODO` must stay literal
or the feature breaks), typeface names, example domains and example handles.

If a string genuinely is not interface language, add a justified entry to
`ALLOWED` in `check-i18n.mjs` rather than translating it.

**Terminology is English-only by decree.** Blocks guarded by
`@if (terminologyAvailable())` render only under English — the post/tweet/florp
vocabulary has no translatable plural. The gate already skips them; leave them
alone.

## Traps in this codebase

- **`UiLocale` must not inject `TranslocoService`.** It sits in nearly every
  service's DI graph; taking that dependency produced 117 `No provider for
  TRANSLOCO_TRANSPILER` failures in services unrelated to translation.
- **Templates are CRLF.** Match on normalised text, or write the file back with
  its original line ending.
- **Never patch a `.mjs` containing `\n` escapes with a Python string-replace** —
  the escapes become literal newlines and the file stops parsing. Same for bash
  heredocs and curly apostrophes: write migration scripts to a file.
- **Run the full suite after touching anything shared.** Registries,
  `client-prefs.ts`, `publish-wizard.ts` and `pkm-tags.ts` have consumers outside
  the directory being migrated.
- **A key can already exist while the template still hardcodes its English.**
  `settings.blue.zen` was declared *and translated* while the template carried
  the literal words. Grep the declarations before inventing a key, and reuse
  rather than adding a second one for the same sentence.
- **A suspiciously small scan is a symptom, not a result.** `i18n-scan.mjs` once
  under-reported `account-analytics.html` as 25 strings when it held 88: an
  apostrophe inside an HTML comment sent the tag regex hunting for its pair and
  swallowed everything between. That is fixed, but the lesson stands — if a
  large template scans as nearly clean, say so rather than believing it. A
  scanner that under-reports looks exactly like a finished directory.

## Done means

- `npm run check:i18n` prints `i18n OK` with your directory in the count.
- `grep` for English defaults in `.ts` (step 2b) comes back empty.
- The gate cannot see three of the four ways this goes wrong: an English string
  the scanner never found, a declared key the template never uses, and a
  translation that means the wrong thing. Only your own reading catches those.
- `node scripts/i18n-scan.mjs` on each template in the directory reports only
  strings you can justify (pipe formats like `'medium'`, or `ALLOWED` entries).
- Lint clean, Prettier clean, `npm run test:ci` green.
- No key concatenates a sentence and no plural is built by gluing an `s`.
