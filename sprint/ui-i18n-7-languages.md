# i18n Sprint 7 — The day-one eight

Status: PLANNED
Depends on: [[ui-i18n-6-plurals-and-dates]]

## Goal

Translate the app into French, German, Japanese, Finnish, Icelandic, Russian, Swedish and Spanish,
and turn the language picker on.

By now this sprint is mostly *execution*: the machinery from [[ui-i18n-2-extraction]] does the work,
and this sprint runs it eight times and checks the results. If it turns out to be harder than
that, the machinery was wrong and the fix belongs upstream — not in eight piles of hand-patching.

## Order

Deliberately hardest-first, because a pipeline flaw found in Icelandic is cheap to fix before
seven more files exist and expensive after:

**is → fi → ru → ja → de → fr → sv → es**

- **Icelandic** — smallest training corpus, highest risk of confidently wrong output.
- **Finnish** — 15 cases, compounds that overflow every `max` budget.
- **Russian** — 6 plural categories, gendered verb agreement.
- **Japanese** — no spaces or plurals, different line-breaking, counter words.
- **German** — compound overflow, `du`/`Sie` register choice.
- **French, Swedish, Spanish** — the well-supported ones. If the pipeline is going to work
  anywhere it works here, so they are the cheap tail, not the proving ground.

## Per-language loop

For each locale:

1. `make i18n-todo LANG=xx` — work file with keys, English, context, glossary.
2. Translate via the `translate-ui` skill, in batches by area so the agent holds consistent
   register and vocabulary across related strings. Do not translate 3000 keys in one pass;
   consistency degrades and nothing is reviewable.
3. `make check-i18n` — placeholder parity, markup parity, plural categories, JSON validity,
   `max` overflow report.
4. **Look at it.** Force the locale in the footer picker and walk the main surfaces: home, a post,
   compose, settings, first-run, login, an error state. This is the only human review available,
   and it catches layout breakage that no checker can — overflowing buttons, wrapped nav, clipped
   labels.
5. Fix what the walkthrough finds. Feed genuine traps back into the skill's per-language notes so
   the next fifty languages inherit the lesson.

## Turning the picker on

`SUPPORTED_LOCALES` grows from `['en']` to nine entries. Per [[ui-i18n-1-foundation]] the footer
picker and the Settings control **become visible automatically** once more than one locale ships —
no separate feature flag, no code change beyond the constant.

At that moment browser negotiation goes live too: a German visitor gets German on first paint. Two
things to verify before landing, because both are silent failures:

- **Locale JSON loads under every base href** — `/`, `/_ui/`, `/canary/`, and each published
  subpath. A 404 on `de.json` degrades to English silently, so it will not be reported, only
  suffered.
- **Negotiation runs before first paint**, or the app flashes English before switching. Check the
  loading path — a visible flash on every visit is a worse first impression than English would
  have been.

## Payload

Nine dictionaries at roughly 3000 keys. **Only the active locale is fetched**, so a reader
downloads exactly one — this is the payoff of runtime dictionaries over compile-time bundles.
Confirm the files are not being inlined into the main bundle, and that they are hashed or
cache-busted so a corrected translation actually reaches people.

## Honesty about quality

These are machine translations, reviewed by someone who does not read most of these languages.
That is a legitimate trade — the alternative is no translations for anyone, ever — but it should
be stated rather than implied:

- Note in the language picker or Settings that translations are machine-generated, with a link to
  report a bad string. The existing bug-report dialog in the footer is right there.
- A reported string is cheap to fix: one key, one file, no rebuild of anything else.
- If a native speaker ever volunteers for a language, their edits drop straight into the same JSON
  file — the pipeline does not need to change to accept human work, which is the point of keeping
  translated files hand-owned and never machine-rewritten.

## Done when

- [ ] Eight locale files pass all `check-i18n` rules.
- [ ] Each has had a human walkthrough of the main surfaces at its own locale.
- [ ] Picker and Settings control are visible and switch live without reload.
- [ ] Browser negotiation works for a fresh visitor; an explicit choice still overrides it.
- [ ] Locale files load under every deployed base href.
- [ ] Machine-translation provenance is disclosed with a reporting path.
- [ ] Per-language notes in the `translate-ui` skill updated with what was actually learned.

## After this

Language #9 through #60 are each one `make i18n-todo`, one skill-guided translation, one
`check-i18n`, one walkthrough, one line in `SUPPORTED_LOCALES`. No code changes. That was the
whole objective of the epic.
