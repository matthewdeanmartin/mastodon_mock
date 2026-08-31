---
name: translate-ui
description: Translate Mockingbird's interface strings into another language. Use when filling in public/i18n/<lang>.json, working an i18n-context/todo-<lang>.md work order, or adding a new UI language.
---

# Translating Mockingbird's interface

You are translating the **interface** of a Mastodon/fediverse client — buttons, labels, settings,
error messages. Not post content, not documentation.

## Before you start

1. Read the work order: `ui/i18n-context/todo-<lang>.md` (generate with `make i18n-todo L=xx`).
   It contains every key you need, its English, and its context entry.
2. Read the glossary below. **This is the part that matters.** Most bad UI translations are not
   grammar failures — they are a correct translation of the wrong sense of a word.
3. Write into `ui/public/i18n/<lang>.json`, then run `make i18n` to verify.

Run the `make` commands from `ui/`. The variable is deliberately `L`, not `LANG`:
POSIX shells already reserve `LANG` for the process locale.

## Why the glossary exists

Handed `{"status.boost.action": "Boost"}` with no context, a translator — human or model —
reasonably produces the verb meaning *amplify, promote, increase*. In Chinese that can land in the
register of a municipal economic-development slogan. The word is not wrong in general; it is wrong
**here**, because `Boost` is fediverse jargon meaning "re-share someone else's post, unmodified".

Nearly every core noun in this app has that problem.

## Glossary — the words that are not what they look like

| Term | What it is NOT | What it IS | Guidance |
|---|---|---|---|
| **Boost** | amplify, promote, increase, boost a signal | Re-share a post unmodified, like a retweet | Use the locale's established Mastodon term. Both noun and verb. |
| **Post** | fence post, mail, job position, to post a letter | A status message | Use the locale's established Mastodon term. |
| **Toot** | a horn sound, a hoot | A post (Mastodon's older, whimsical word) | Keep the whimsy. Many locales keep "toot" untranslated. |
| **Handle** | a grip, to cope with, a door handle | An address like `@user@server.social` | Frequently left in English. Never "grip". |
| **Instance** / **Server** | an example, an occurrence | One server in the fediverse | Follow local Mastodon convention. |
| **Feed** | feeding, nourishment, to feed an animal | A stream of posts | Never the food sense. |
| **Thread** | sewing thread, a screw thread | A chain of replies | Use the discussion sense. |
| **Follow** / **Unfollow** | to come after, to succeed | Subscribe to an account | Social-network sense only. |
| **Mute** | silent, mute button, speechless | Hide someone's posts without unfollowing | Must stay **distinct from Block**. |
| **Block** | a city block, a building block | Sever contact entirely | Must stay **distinct from Mute**. |
| **Filter** | a coffee filter, a photo filter | A rule that hides matching posts | |
| **Like** / **Favourite** | similar to, as in | Mark a post as liked | Follow local Mastodon convention. |
| **Fediverse** | — | The federated social network | Usually kept as a coinage. |
| **Fail whale** | a whale that failed | The error-page mascot, a joke about early Twitter's overload page | Keep the joke or find a local equivalent. **Never literal.** |
| **Starter kit** | a beginner's toolbox | A curated bundle of accounts to follow | Explain the sense; do not calque. |
| **Interface language** | — | The language of the app's own UI | Distinct from *posting language* and *known languages*, which are separate settings. Keep all three distinguishable. |

### Never translate

`Mockingbird`, `Mawkingbird` (product names), `Mastodon`, `Bluesky`, `Twitter`, `RSS`, `OPML`,
`ActivityPub`, `@handles`, `#hashtags`, URLs, code, and anything marked `dnt` in its context entry.

### The anchor rule

**Where the target language already has an established Mastodon translation for a term, use it.**
Mastodon has been translated by humans into most of these languages. Matching their vocabulary
means users get words they already recognise, and it costs nothing. Do not invent a new word for
"boost" when the locale's Mastodon users already have one.

## Rules

1. **Preserve every `{{placeholder}}` exactly.** Same spelling, never translated. Each must appear
   exactly once in your output. Reorder only if the target grammar demands it. A dropped
   `{{name}}` renders a blank where a username should be — this is the single most damaging error
   you can make, and `make i18n` fails on it.
2. **Keep inline markup intact** — tags, entities, and `&amp;`-style escapes.
3. **Respect `max`.** It is a character budget for a button or label that will visibly break if
   overflowed. Prefer a shorter natural word over a longer literal one. German compounds and
   Finnish case endings overflow easily.
4. **Translate meaning, not words.** `"You reached the end. That's allowed here."` is a joke about
   infinite scroll and the permission to stop. Render *that*, not the sentence.
5. **Match `tone`.** `playful` stays playful; `warning` and `error` are plain, calm and precise.
   Never make a security or data-loss warning cute.
6. **Choose a formality register once, and hold it across the entire file.** This is a social app
   used casually: prefer informal (`du` in German, `tu` in French, `ты`-neutral phrasing in
   Russian, polite です/ます in Japanese — not keigo). Inconsistent register within one UI reads
   worse than the "wrong" choice made consistently.
7. **Prefer gender-neutral constructions.** Strings interpolate usernames of unknown gender;
   never make the surrounding grammar assume one.
8. **Output only the keys you were asked for.** Merge into the existing file. Never reorder,
   reformat, or modify keys you were not given — translated files are hand-owned and no tool
   rewrites them.
9. **When genuinely unsure, leave the key out.** A missing key falls back to English cleanly
   (Transloco `useFallbackTranslation`). A confidently wrong translation is invisible to a
   maintainer who does not read the language, and therefore permanent. **Omission is the safe
   failure; guessing is not.**
10. **Never invent terminology-setting vocabulary.** The post/tweet/florp/skeet/toot vocabulary
    picker is an **English-only feature by decree** — non-English locales use the canonical noun
    only. Do not attempt a German "florp".

## Per-language notes

Append what you learn here; the next fifty languages inherit it.

### Russian (`ru`)
- **6 plural categories** (`one/few/many/other` + fractions). When plurals arrive (sprint
  ui-i18n-6), all required categories must be supplied or `make i18n` fails.
- Past-tense verbs agree with subject gender. `{{name}} boosted` would force a gender guess —
  restructure to a gender-neutral form instead.

### Finnish (`fi`)
- 15 cases; compound words get very long. **`max` is binding, not advisory.**
- No grammatical gender — easy for rule 7.

### Icelandic (`is`)
- Smallest training corpus of the day-one languages: **the highest-risk language here.** Apply
  rule 9 more readily than elsewhere.
- Strong purist tradition — prefer native coinages over English loanwords where one exists.
- Four cases, three genders; watch agreement around interpolated nouns.

### Japanese (`ja`)
- No plurals and no spaces. Watch line-breaking in narrow columns; long unbroken runs overflow.
- Counter words vary by noun class.
- Polite です/ます, not keigo, not plain form.

### German (`de`)
- Compounds overflow buttons — the most common `max` violation.
- Use `du`, not `Sie` (rule 6).

### French (`fr`)
- Narrow no-break space (U+202F) before `: ? ! ;` — not a regular space, not nothing.

### Swedish (`sv`), Spanish (`es`)
- Well-supported, few traps. Still hold the register and glossary rules.

## Verify

```bash
make i18n          # placeholder + markup parity, valid JSON, coverage report
```

Fatal: a dropped or duplicated placeholder, broken markup, invalid JSON, a key not in `en.json`.
Reported but not fatal: incomplete coverage, `max` overflow, a value identical to English.

Then **look at it** — force the locale in the footer language picker and walk the main surfaces.
That is the only review that catches a button whose text no longer fits.

### Trap-word sweep

`make i18n` passes at 100% coverage on a file that says the unblock-everyone
button *blocks the amnesty*. Coverage counts keys; it cannot read. Before calling
a language done, grep the finished file for the **wrong sense** of each glossary
term — the sense a translator reaches for when the word arrives without context.
In German this found real bugs on two separate passes:

| Wrong rendering | What it actually says | Should be |
|---|---|---|
| `Anruf` | a telephone call | API-Aufruf / Anfrage |
| `verfolgen` | to stalk or pursue | folgen (social sense) |
| `Zeitleiste` | a chronology widget | Timeline |
| `Licht` | illumination | Hell (the theme) |
| `Pasten` | pasta | Pastes |
| `Wal` | a literal whale | Fail Whale, kept |
| `Girokonto` | a bank current account | aktuelles Konto |

Build the same table for your language from the glossary above: for each term,
write down the sense you do **not** mean, then search for it. A hit is not proof
of a bug — `Analyseskript` is a legitimate "script" — but every hit deserves a
look, and the cost of the sweep is minutes.

To make the picker available while translating, add the locale to `IN_PROGRESS_LOCALES` in
`ui/src/app/i18n/locale.ts`. It will appear on `/test/` and `/canary/`, with missing keys falling
back to English. Move it to `PRODUCTION_LOCALES` only after the locale's work order is complete,
`make i18n` and `make test` pass, and the visual walkthrough is done.
