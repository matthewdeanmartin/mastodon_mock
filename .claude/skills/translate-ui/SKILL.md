---
name: translate-ui
description: Translate Mockingbird's interface into another language, or add a new UI language end to end. Use when filling in public/i18n/<lang>.json, working an i18n-context/todo-<lang>.md work order, adding a locale to IN_PROGRESS_LOCALES, or reviewing a locale someone else translated.
---

# Translating Mockingbird's interface

You are translating the **interface** of a Mastodon/fediverse client — buttons, labels,
settings, error messages. Not post content, not documentation.

Roughly 5,700 keys per language, and the plan is 50–60 languages. So this skill is written
for **throughput at constant quality**, not for one careful language. Follow the procedure
in order; it is short, and every step in it exists because skipping it cost a re-read of
5,700 keys at least once.

**If you are coordinating this work across multiple dispatches (subagents, forks, or fresh
sessions): dispatch count is the dominant cost, not translation volume.** One 5,700-key
language done as ~5 large dispatches costs a small fraction of the same language done as
~50 small ones, because every dispatch re-pays the fixed cost of reading this skill and the
glossary before it translates anything. See "Batch size" in step 3 below before deciding how
to split the work.

---

## The procedure

Run everything from `mastodon_mock/ui`. The Make variable is `L`, not `LANG` — every POSIX
shell already exports `LANG`, and `make i18n-todo` with no argument once silently produced a
work order for a locale called `en_US.UTF-8`.

Invoke the batch/merge scripts through their `make` targets (`make i18n-batch L=id N=250
P=area`, `make i18n-merge L=id F=file.json`), not by calling `node scripts/i18n-batch.mjs`
directly with positional `N=`/`P=` arguments — the script does not parse those as flags on
its own, only `make` wires them in as the variables the script expects.

### 1. Register the locale (2 minutes)

```ts
// src/app/i18n/locale.ts
export const IN_PROGRESS_LOCALES = ['de', 'fr', 'id'] as const;   // add yours
export const LOCALE_ENDONYMS = { …, id: 'Bahasa Indonesia (sedang dikerjakan)' };
```

The endonym is the language's name **in its own language**, with an in-progress marker in
that language too. Someone who has landed in a language they cannot read needs to find their
own language in this list; "Indonesian" is no help to a reader who only reads Indonesian.

`IN_PROGRESS_LOCALES` ship on `/test/` and `/canary/` only. Do this **first**, not last:
you need the picker to look at your own work while translating. Move the locale to
`PRODUCTION_LOCALES` only when the checklist at the bottom is done.

### 2. Write the glossary **before translating anything**

Copy `i18n-context/glossary-id.md` to `glossary-<lang>.md` and fill it in. It takes twenty
minutes and it is the highest-leverage step in the whole process.

It must settle, in writing:

- **The formality register**, chosen once and held. This is not a style preference — German
  shipped 466 keys of `du` against 321 of `Sie`, and all 321 had to be rewritten by hand.
- **Every term in the glossary table below**, resolved to one word for this language.
- **The wrong senses to avoid** — write down, for each term, the meaning you do *not* mean.
  That list becomes the locale's trap words in step 5.

Then encode the mechanical parts in `scripts/i18n-locale-rules.mjs`: `rules` (hard gates that
reject a batch) and `traps` (advisory greps). See that file's header for which is which — a
gate with false positives gets worked around, which is worse than no gate.

### 3. Translate in batches, through the gate

```bash
make i18n-batch L=id --areas          # what's left, biggest area first
make i18n-batch L=id N=250 P=settings.connections
```

`i18n-batch` prints only the keys still missing, as `key<TAB>English<TAB>context hints`.
Translate a slice into a flat JSON file (`{"dotted.key": "text"}`) and merge it:

```bash
make i18n-merge L=id F=tmp_batch.json
```

**Nothing reaches a locale file except through `i18n-merge`.** It rejects the batch *whole*
on a key that isn't in `en.json`, placeholder drift, markup drift, a `max` overflow, or any
rule the locale declares. On rejection, the merge output names the offending key(s) — fix
just those and resubmit the same file; do not throw away a large batch over one bad key.

Re-run `i18n-batch` after each merge and the next slice appears. **The locale file is the
progress ledger** — there is no bookkeeping to keep in your head or in a scratch note.

> **Write batch files with the Write tool, not a bash heredoc.** Curly apostrophes (’),
> nested quotes and em dashes break heredocs, and the shell error arrives after you have
> already spent the tokens composing the batch.

> **Write scratch batch files inside `mastodon_mock/ui/`** (e.g. `tmp_batch.json`), not
> `/tmp/` — in some sandboxes `/tmp/*.json` written by the Write tool doesn't resolve to a
> path the merge script can see, and the ENOENT only surfaces after the merge attempt.
> Delete the scratch file once it merges cleanly.

#### Batch size: go big, not 110-at-a-time

A 5,700-key language costs the same *whether you run it as fifty small dispatches or five
large ones* — but the dispatches themselves are not free. Each fresh session or subagent
pays fixed overhead (reading this skill, reading the glossary, orienting) before translating
a single key. Doing that fifty times instead of five is the single biggest cost driver in
this workflow — larger than anything about the translation itself.

So default to the largest batch that still fits one attention span and one merge:

- **`N=250`–`N=300`** per `i18n-batch` slice, not 110. The gate doesn't care about batch
  size; only your own ability to hold the slice in mind while translating it does.
- **When several named areas are each small (under ~20 keys), translate many of them in one
  dispatch.** Don't spend a whole subagent invocation on an 8-key area — collect a dozen or
  two small areas into one prompt, work through them in sequence (get slice → translate →
  merge → confirm 0 remaining → next), and report once at the end.
- **Once the remaining work has fragmented into hundreds of 1-2 key areas** (the normal
  shape of the last 10–15% of a language, where leftover keys are scattered one-per-component
  across the whole app), **stop targeting by area name.** Call `i18n-batch` with no `P=`
  filter to pull the next N missing keys regardless of area, translate that flat slice, merge,
  and repeat. Area names stop being a useful unit of work once no area has more than a
  handful of keys left — a flat pull is exactly as safe (still gated by `i18n-merge`) and
  avoids one dispatch per singleton area.
- If you are delegating to a subagent (a fork, or a fresh dispatch), **hand it the largest
  reasonable chunk of remaining work in one prompt** — many named areas, or "keep pulling
  flat 250-key batches until 0 remain or you've done N rounds" — rather than one area per
  dispatch. Reserve a fresh dispatch per area only for the first few large, high-context
  areas early in a language, where extra care on one region (correct terminology carrying
  over, per-area trap review) is worth the overhead.

### 4. Feed corrections back after every batch

When a batch gets rejected, or you find a bad rendering while reviewing, **append the
correction to the glossary file** before starting the next batch. This is what makes quality
rise across a language instead of staying flat: in French, batch C caught its own mistake by
having read batch B's note. Five lines in the glossary is cheaper than the same error in
forty more keys.

### 5. Sweep for wrong-sense translations

```bash
make i18n-traps L=id
```

`make i18n` passes at 100% coverage on a German file whose unblock-everyone button reads
**"Blockieren Sie die Amnestie"** — *block the amnesty*, the exact opposite of what it does.
Coverage counts keys; it cannot read. This sweep greps for the wrong senses you wrote down in
step 2, plus any value left identical to English.

A hit is evidence, not a verdict (`Analyseskript` legitimately contains "script"), which is
why it never fails a build. Read every hit.

### 6. Verify and look at it

```bash
make i18n        # placeholder + markup parity, valid JSON, coverage report
make test        # 5,500+ specs; translations should not move any of them
```

Then **force the locale in the footer picker and walk the main surfaces.** That is the only
review that catches a button whose text no longer fits its box.

---

## Why the glossary exists

Handed `{"status.boost.action": "Boost"}` with no context, a translator — human or model —
reasonably produces the verb meaning *amplify, promote, increase*. In Chinese that can land in
the register of a municipal economic-development slogan. The word is not wrong in general; it
is wrong **here**, because `Boost` is fediverse jargon meaning "re-share someone else's post,
unmodified".

Nearly every core noun in this app has that problem. And the resulting defect is *invisible* to
a maintainer who does not read the language, and therefore permanent.

## Glossary — the words that are not what they look like

| Term | What it is NOT | What it IS | Guidance |
|---|---|---|---|
| **Boost** | amplify, promote, increase, boost a signal | Re-share a post unmodified, like a retweet | Use the locale's established Mastodon term. Both noun and verb. |
| **Post** | fence post, mail, job position, to post a letter | A status message | Use the locale's established Mastodon term. |
| **Toot** | a horn sound, a hoot | A post (Mastodon's older, whimsical word) | Keep the whimsy. Many locales keep "toot" untranslated. |
| **Handle** | a grip, to cope with, a door handle | An address like `@user@server.social` | Frequently left in English. Never "grip". |
| **Instance** / **Server** | an example, an occurrence | One server in the fediverse | Follow local Mastodon convention. |
| **Feed** | feeding, nourishment, to feed an animal | A stream of posts | Never the food sense. |
| **Timeline** | a chronology widget, a history graphic | The stream of posts you scroll | German shipped `Zeitleiste` in 5 keys against 47 correct ones. |
| **Thread** | sewing thread, a screw thread | A chain of replies | Use the discussion sense. |
| **Follow** / **Unfollow** | to come after, to pursue, to stalk | Subscribe to an account | Social-network sense only. German shipped *stalked* in 9 keys. |
| **Mute** | silent, mute button, speechless | Hide someone's posts without unfollowing | Must stay **distinct from Block**. |
| **Block** | a city block, a building block | Sever contact entirely | Must stay **distinct from Mute**. |
| **Filter** | a coffee filter, a photo filter | A rule that hides matching posts | |
| **Like** / **Favourite** | similar to, as in | Mark a post as liked | Follow local Mastodon convention. |
| **Light** (theme) | illumination, low weight | The pale colour scheme | Pairs with **Dark**. Never the lamp sense. |
| **Paste** | glue, pasta, the verb to paste | A pastebin item — a product noun here | Keep it recognisable; German shipped *pasta*. |
| **Call** (API) | a telephone call | A request to a server | German shipped *phone calls* twice, on two separate passes. |
| **Current account** | a bank chequing account | The account now in use | |
| **Fediverse** | — | The federated social network | Usually kept as a coinage. |
| **Fail whale** | a whale that failed | The error-page mascot, a joke about early Twitter's overload page | Keep the joke or find a local equivalent. **Never literal.** |
| **Starter kit** | a beginner's toolbox | A curated bundle of accounts to follow | Explain the sense; do not calque. |
| **Interface language** | — | The language of the app's own UI | Distinct from *posting language* and *known languages*, which are separate settings. Keep all three distinguishable. |

### Never translate

`Mockingbird`, `Mawkingbird` (product names), `Mastodon`, `Bluesky`, `Twitter`, `RSS`, `OPML`,
`ActivityPub`, `Raindrop.io`, `OpenRouter`, `Stripe`, `Hugo`, `@handles`, `#hashtags`, URLs,
code samples, typeface names, example domains, and anything marked `dnt` in its context entry.

### The anchor rule

**Where the target language already has an established Mastodon translation for a term, use
it.** Mastodon has been translated by humans into most of these languages. Matching their
vocabulary means users get words they already recognise, and it costs nothing. Do not invent a
new word for "boost" when the locale's Mastodon users already have one.

---

## Rules

1. **Preserve every `{{placeholder}}` exactly.** Same spelling, never translated. Reorder only
   if the target grammar demands it. A dropped `{{name}}` renders a blank where a username
   should be — the single most damaging error available. `i18n-merge` rejects it.
2. **Keep inline markup intact** — tags, entities, `&amp;`-style escapes. Also gated.
3. **Respect `max`.** A character budget for a button that will visibly break if overflowed.
   Prefer a shorter natural word over a longer literal one. Gated.
4. **Translate meaning, not words.** `"You reached the end. That's allowed here."` is a joke
   about infinite scroll and the permission to stop. Render *that*, not the sentence.
5. **Match `tone`.** `playful` stays playful; `warning` and `error` are plain, calm and
   precise. Never make a security or data-loss warning cute.
6. **Choose a formality register once, and hold it across the entire file.** This is a social
   app used casually: prefer informal (`du` in German, `tu` in French, `kamu` in Indonesian,
   ты-neutral phrasing in Russian, polite です/ます in Japanese — not keigo). Inconsistent
   register within one UI reads worse than the "wrong" choice made consistently. Record the
   choice in the glossary and gate it in `i18n-locale-rules.mjs`.
7. **Prefer gender-neutral constructions.** Strings interpolate usernames of unknown gender;
   never make the surrounding grammar assume one. Where a placeholder really is variable in
   gender, **restructure so no agreement is needed** — do not stack endings (`·e`) to dodge it.
8. **Output only the keys you were asked for.** Merge, never reorder or reformat. Translated
   files are hand-owned; no tool rewrites them, so a human volunteer's edits drop straight in.
9. **When genuinely unsure, leave the key out.** A missing key falls back to English cleanly
   (Transloco `useFallbackTranslation`). A confidently wrong translation is invisible to a
   maintainer who does not read the language, and therefore permanent. **Omission is the safe
   failure; guessing is not.** This is about *terminology you don't know* — not about a string
   that merely embeds a code sample or a URL, which should still be translated around.
10. **Never invent terminology-setting vocabulary.** The post/tweet/florp/skeet/toot picker is
    an **English-only feature by decree** — non-English locales use the canonical noun only.
    Do not attempt a German "florp". Those keys are already excluded from the work order.
11. **Never build a sentence by concatenation, and never `.replace()` display text.** If the
    English does either, that is a source bug: fix it with one whole key per variant plus
    `{{params}}`, rather than translating around it.

---

## Per-language notes

Append what you learn here; the next fifty languages inherit it.

### Indonesian (`id`)
- No grammatical gender, no verb agreement, **no plural inflection**. Rule 7 is free. Do not
  reduplicate (`postingan-postingan`) to render an English `-s` — it means *various assorted
  posts*. ICU plurals need only an `other` category.
- Register: `kamu`, never `Anda` (gated). Dropping the pronoun entirely is neutral, not a slip,
  and often the most natural choice.
- Runs ~15–20% longer than English; `max` is binding. The `-mu` enclitic (`akunmu`) buys space.
- Established terms: linimasa (timeline), utas (thread), markah (bookmark), bisukan (mute),
  blokir (block), Terang/Gelap (Light/Dark theme).

### German (`de`)
- Compounds overflow buttons — the most common `max` violation.
- Use `du`, not `Sie` (rule 6). Third-person *sie/ihre* is legitimate, so a naive `/\bSie\b/`
  probe has a real false-positive rate; the gate matches capitalised `Sie` mid-sentence only.
- Wrong senses that actually shipped: Anruf, verfolgen, Zeitleiste, Licht, Pasten, Girokonto,
  Faden, Futter, Griff, a literal Wal.

### French (`fr`)
- Narrow no-break space **U+202F** before `: ? ! ;` — not a regular space, not nothing. Gated,
  with `<code>`, URLs and entities exempt.
- Typographic `’`, never ASCII `'`. Gated.
- Informal `tu`, zero `vous` across 5,718 keys. Gated.
- Never `·e` inclusive endings — `{{post}}` holds the English-only terminology noun and is
  therefore always masculine. Restructure instead (rule 7).

### Russian (`ru`)
- **6 plural categories** (`one/few/many/other` + fractions). All required categories must be
  supplied or `make i18n` fails.
- Past-tense verbs agree with subject gender. `{{name}} boosted` would force a gender guess —
  restructure to a gender-neutral form instead.

### Finnish (`fi`)
- 15 cases; compounds get very long. **`max` is binding, not advisory.**
- No grammatical gender — easy for rule 7.

### Icelandic (`is`)
- Smallest training corpus of the day-one languages: **the highest-risk language here.** Apply
  rule 9 more readily than elsewhere.
- Strong purist tradition — prefer native coinages over English loanwords where one exists.
  (This is the opposite of the Indonesian strategy; do not carry one language's instinct into
  another.)
- Four cases, three genders; watch agreement around interpolated nouns.

### Japanese (`ja`)
- No plurals and no spaces. Watch line-breaking in narrow columns; long unbroken runs overflow.
- Counter words vary by noun class.
- Polite です/ます, not keigo, not plain form.

### Swedish (`sv`), Spanish (`es`)
- Well-supported, few traps. Still hold the register and glossary rules.

---

## Done checklist

A locale moves from `IN_PROGRESS_LOCALES` to `PRODUCTION_LOCALES` when **all** of these hold:

- [ ] `make i18n-batch L=xx --areas` reports 0 remaining
- [ ] `make i18n` passes — no placeholder, markup or JSON errors
- [ ] `make i18n-traps L=xx` reviewed, every hit judged (not merely run)
- [ ] `make test` green — a translation should not move a single spec
- [ ] the glossary file exists, with its corrections log filled in
- [ ] someone forced the locale in the footer picker and walked home, a profile, settings,
      compose and one connector page

Coverage alone is never the criterion. A file at 100% coverage can still tell a reader that
the unblock button blocks the amnesty.

---

## Files

```
src/app/i18n/locale.ts              PRODUCTION_LOCALES / IN_PROGRESS_LOCALES / endonyms
public/i18n/en.json                 GENERATED from `// i18n` comments — never hand-edit
public/i18n/<lang>.json             hand-owned; only i18n-merge writes it
i18n-context/en.context.json        the translator's brief: desc/surface/max/tone/glossary/dnt
i18n-context/glossary-<lang>.md     this language's locked terminology + corrections log
scripts/i18n-locale-rules.mjs       per-locale merge gates and trap words
scripts/i18n-merge.mjs              the gate — the only writer
scripts/i18n-batch.mjs              next slice of missing keys
scripts/i18n-traps.mjs              wrong-sense sweep
scripts/i18n-todo.mjs               the full work order (the spec; too big to hold at once)
```
