# i18n Sprint 2 — Extraction, the context sidecar, and the translator skill

Status: **COMPLETE** (2026-08-30)

## What actually shipped, where it differs from the plan

- **The English-source question was settled as declaration comments.** `// i18n <key>: <English>`
  (or `<!-- i18n ... -->`) beside each key; `extract-i18n.mjs` scrapes them into `en.json`, and
  `--check` fails on drift. Templates stay readable while editing a component, and `en.json` is
  genuinely generated rather than aspirationally so.
- **`en.context.json` lives in `ui/i18n-context/`, not `public/i18n/`.** `angular.json` copies
  `public/**/*` verbatim, so a context file there would ship to every browser and roughly double
  the i18n payload for zero runtime value.
- **The staleness mechanism is a hash sidecar** — `i18n-context/stamps.json`, locale → key → hash
  of the English at translation time. Git-history diffing was rejected: it breaks on renames and
  cannot see a hand-edited translation.
- **`make i18n-todo` takes `L=de`, not `LANG=de`.** Every POSIX shell already exports `LANG`
  (`en_US.UTF-8` here), so the obvious spelling silently generated a work order for a locale named
  `en_US.UTF-8`. Found by running it. The script now also rejects non-locale-shaped arguments.
- **No API-calling script exists, by design** — the boss's decree. Tooling prepares work orders
  and verifies results; a Claude Code agent does the translation with the `translate-ui` skill.
Depends on: [[ui-i18n-1-foundation]]

## Goal

Build the machinery that makes **language #61 cost almost nothing**, and that stops a frontier
model translating `Boost` as a municipal economic-development slogan.

Nothing user-visible ships in this sprint. What ships is the difference between "we can do eight
languages if someone babysits it" and "we can do sixty, repeatedly, on a schedule."

## Why this sprint exists at all

The naive pipeline is: hand `en.json` to a model, ask for `zh.json`, commit the result. It fails
for a specific and unfixable reason — **a JSON dictionary strips exactly the information a
translator needs.** `"status.boost.action": "Boost"` does not say whether Boost is a noun or a
verb, whether it appears on a 12-pixel icon button or in a paragraph, whether it is this app's
jargon or ordinary English, or that it means *re-share, unmodified* rather than *amplify*.

A human translator would ask. A model will not ask; it will guess, confidently, 3000 times.

So the deliverable is a **translator's brief as data**: written once per key, in English, by the
person who wrote the feature — then reused unchanged for every language forever. Sixty languages
amortize one writing cost.

## 2a. `scripts/extract-i18n.mjs`

Scans templates and `.ts` sources for translation keys and regenerates `public/i18n/en.json`.

- Input: `{{ 'key' | transloco }}`, `transloco: {params}`, `t('key')` in TS, and attribute forms.
- Output: `en.json`, **sorted by key**, stable formatting. Sorted output matters — an unstable
  order makes every diff unreadable and every merge a conflict.
- `--check` mode: fail if `en.json` on disk differs from what the extractor would write. This is
  what `check:i18n` calls, and it is how `en.json` stays genuinely generated rather than
  drifting into a hand-edited file that only claims to be generated.

**The English source text problem.** Keys alone do not carry English. Two options, and the sprint
must pick one in its first hour because everything downstream depends on it:

- The extractor reads English from a **hand-maintained `en.source.json`** — simple, but that is
  just `en.json` under another name, so it is not really generated.
- **Recommended:** templates carry an English default inline for extraction only, and the
  extractor scrapes it. This keeps templates readable while editing a component, which is the
  main cost of key-based i18n:

  ```html
  {{ 'footer.privacy' | transloco }}          <!-- key only -->
  <!-- i18n-en: Privacy -->
  ```

  A trailing comment is ugly but survives Prettier and needs no custom pipe signature. Decide,
  document in the PR, and apply it uniformly — a half-converted convention is worse than either.

Also emits `--report-context-gaps`: keys present in `en.json` but absent from `en.context.json`.
Never fatal — see 2c.

## 2b. `public/i18n/en.context.json` — the translator's brief

Parallel to `en.json`, same keys, hand-written, never generated. One entry per key that needs one:

```json
{
  "status.boost.action": {
    "desc": "Button that re-shares someone else's post to your own followers, unmodified.",
    "surface": "icon button, status card toolbar",
    "max": 12,
    "glossary": ["boost"],
    "pos": "verb"
  },
  "footer.end": {
    "desc": "Reassurance at the bottom of a finite feed — this app's feeds end, unlike an infinite scroll. Wry, warm tone.",
    "surface": "footer paragraph",
    "tone": "playful"
  },
  "compose.placeholder": {
    "desc": "Placeholder in the empty post composer.",
    "surface": "textarea placeholder",
    "max": 40
  }
}
```

Fields, all optional except `desc`:

| Field | Meaning | Why the translator needs it |
|---|---|---|
| `desc` | What the string means and does | The whole point. Disambiguates every homograph. |
| `surface` | Where it renders | A button and a paragraph have different registers and lengths |
| `max` | Soft character budget | Finnish and German overflow narrow buttons; the translator must know it is tight |
| `glossary` | Glossary terms used | Forces consistency with 2c and flags app jargon |
| `pos` | Noun / verb / adjective | `Post`, `Boost`, `Like`, `Filter`, `Mute` are all both in English |
| `tone` | neutral / playful / warning / error | This app is wry in places; a warning must not be |
| `placeholders` | What each `{param}` holds | Stops a translator reordering or translating a param |
| `dnt` | Do not translate | Brand names, `@handles`, `#hashtags`, `Mockingbird`, `Mastodon`, `Bluesky` |

### Why not inline in `en.json`

Kept separate so `en.json` stays a plain Transloco dictionary that ships to browsers as-is. The
context file is **build-time only and never shipped** — it would roughly double the payload for
zero runtime value. Confirm it is excluded from the `assets` glob, or it lands in `dist/`.

### `en.context.json` is not required to be complete

Coverage is **reported, never enforced** — the same principle as locale coverage in
[[ui-i18n-1-foundation]]. Most keys are unambiguous (`Cancel`, `Save`, `Settings`) and need nothing.
Requiring an entry per key would be 3000 units of make-work and would train everyone to write
`"desc": "the save button"` to silence a gate.

The *specific* rule that is worth enforcing, and the only fatal one: **a key whose English text
contains a glossary term must have a context entry.** That is precisely the fence-post case, and
it is mechanically detectable.

## 2c. `.claude/skills/translate-ui/SKILL.md` — the glossary and the rules

The skill the translating agent loads. This is not a prompt template that a script fills in; it is
standing instructions for a Claude Code agent doing the work in-harness.

### The glossary

The core asset. Every term this app uses in a sense a dictionary will not give you:

| Term | Sense | Guidance |
|---|---|---|
| Boost | Re-share a post unmodified | Use the locale's established Mastodon term. **Not** amplify/promote/increase. Verb and noun. |
| Post | A status message | **Not** fence post, mail, or job position. |
| Toot | A post (older Mastodon word) | Whimsical register. **Not** a horn sound. |
| Handle | `@user@server` | **Not** grip or cope-with. Often left untranslated. |
| Instance / Server | One fediverse server | Follow local Mastodon convention. |
| Feed | Stream of posts | **Not** feeding/nourishment. |
| Thread | Chain of replies | **Not** sewing thread. |
| Follow / Unfollow | Subscribe to an account | **Not** "come after". |
| Mute / Block | Hide without unfollowing / sever | Mute ≠ Block; keep distinct in the target language. |
| Fediverse | The federated network | Usually kept as a coinage. |
| Fail whale | Error-page mascot | A joke referencing early Twitter. Keep or localize the joke; never translate literally. |
| Mockingbird / Mawkingbird | Product names | **Never translate.** |
| Mastodon / Bluesky / RSS / OPML | Product & protocol names | **Never translate.** |
| Starter kit | Curated bundle of accounts | App jargon; explain, do not calque. |

**Anchor rule:** where the target language already has an established Mastodon UI translation for
a term, use it. Mastodon has been translated by humans into most of these languages; matching
their vocabulary means users get words they already know, and it costs nothing.

### Rules the skill must state

1. **Preserve every `{placeholder}` exactly** — same spelling, never translated, never reordered
   unless the target's grammar demands it and all params still appear exactly once.
2. **Keep HTML/markup intact** where a string contains inline tags.
3. **Respect `max`.** Prefer a shorter natural word over a literal long one. German compounds and
   Finnish cases overflow buttons; a truncated label is worse than a loose one.
4. **Translate meaning, not words.** `"You reached the end. That's allowed here."` is a joke about
   infinite scroll — render the joke, not the sentence.
5. **Match `tone`.** Errors and warnings are plain and calm; playful strings stay playful.
6. **Never translate `dnt` items, `@handles`, `#hashtags`, URLs, or code.**
7. **Formality:** pick the register a social app uses in that language and hold it across the whole
   file — informal `du`/`tu`/`ty` for German, French, Russian; Japanese in polite です/ます, not
   keigo. Inconsistent register within one UI reads worse than the wrong choice made consistently.
8. **Output only keys that were asked for.** Never touch existing translations; never reformat the
   file; never reorder it.
9. **When genuinely unsure, leave the key out.** A missing key falls back to English cleanly
   (per [[ui-i18n-1-foundation]] `useFallbackTranslation`). A confidently wrong translation is
   invisible and permanent. **Omission is the safe failure.**
10. **Never invent a `florp` equivalent** — terminology is out of scope per [[ui-i18n-0-overview]].

### Per-language notes

Where the skill records traps as they are discovered, so the same mistake is not made twice across
sixty languages. Seeded with the known ones:

- **Russian** — 6 plural categories; verbs agree with gender, so `{name} boosted` may need
  restructuring to avoid guessing a user's gender. Prefer gender-neutral constructions.
- **Finnish** — 15 cases; compounds get very long. `max` is binding, not advisory.
- **Icelandic** — smallest training corpus of the day-one eight; the highest-risk language and the
  one most deserving of a native review if a volunteer ever appears. Strong purist tradition:
  prefer native coinages over English loanwords.
- **Japanese** — no plurals, no spaces; watch line-breaking in narrow columns. Counters vary by
  noun class.
- **German** — compounds overflow buttons; `Sie` vs `du` must be chosen once (recommend `du`).
- **French** — mandatory spacing before `:` `?` `!` (use U+202F narrow no-break space).

## 2d. `scripts/i18n-todo.mjs`

`make i18n-todo LANG=de` writes `scratch/i18n-todo-de.md`: every key present in `en.json` and
missing (or stale) in `de.json`, each with its English text and full context entry, plus the
glossary inline.

This is the agent's work order. It is regenerated, never committed. Its whole job is to make the
translating agent's task *incremental*: adding 40 keys produces a 40-key work file, not a 3000-key
one. That property is what keeps the marginal cost of a feature independent of the locale count.

Include a `--stale` mode: keys whose English text changed since the translation was written.
Detecting this needs a fingerprint — store a hash of the English source alongside each translated
value, or keep a `public/i18n/.stamps.json` mapping key → English hash per locale. **Decide the
mechanism here**, because retrofitting staleness detection after eight locales exist means
re-reviewing all of them by hand.

## 2e. Verification: `check-i18n.mjs` gains translation checks

Extends the gate from [[ui-i18n-1-foundation]] with rules that catch a bad translation *mechanically*
— the only review available when nobody on the project reads Icelandic:

- **Placeholder parity** — every `{param}` in the English string appears exactly once in the
  translation. **Fatal.** This catches the single most damaging class of error: a dropped `{name}`
  renders a blank where a username should be.
- **Markup parity** — inline tags survive translation. **Fatal.**
- **No orphan keys** in a locale file that are absent from `en.json`. **Fatal** — they are dead
  weight and usually a sign of a renamed key.
- **Untranslated-identical** — value identical to English. **Report only**; often legitimate
  (`RSS`, `OPML`, `Bluesky`).
- **`max` overflow** — translation exceeds its budget. **Report only**; the budget is soft.
- **Valid JSON, sorted, no duplicate keys.** Fatal.

Placeholder parity is the highest-value check in the epic: it is the one error that is both
common in machine translation and completely invisible to a maintainer who cannot read the
language.

## Done when

- [ ] `make i18n-extract` regenerates `en.json`; `--check` fails on drift and is wired into
      `check:i18n`.
- [ ] `en.context.json` exists with entries for every glossary-bearing key in the migrated surface,
      and its coverage gap is reported.
- [ ] `.claude/skills/translate-ui/SKILL.md` exists with glossary, rules, and per-language notes.
- [ ] `make i18n-todo LANG=xx` emits a complete, self-contained work file.
- [ ] Staleness mechanism chosen, implemented, and documented.
- [ ] Placeholder/markup parity checks fail on a deliberately corrupted fixture.
- [ ] **End-to-end rehearsal:** run the real loop once on the ~12 footer keys from
      [[ui-i18n-1-foundation]] into `de.json` — `make i18n-todo LANG=de`, translate via the skill,
      `make check-i18n`, force `de` in the footer picker, look at it. This is the sprint's actual
      proof; everything above is scaffolding for this one rehearsal.

## Explicitly not in this sprint

Translating any surface beyond the footer rehearsal, plurals, dates, and any template migration.
The eight day-one languages are [[ui-i18n-7-languages]]; this sprint proves the loop on one.
