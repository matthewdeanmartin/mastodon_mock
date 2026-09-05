# UI internationalization — 30-language execution plan

Status: Ukrainian and Taiwan completed; STOPPED. Updated 2026-09-05.
Both have 5,866 accepted/reviewed keys and passing final audits. All translation
workers stopped. See `sprint/ui-i18n-speedup-plan.md` for the proposed next steps;
no pilot or further language rollout has been run or authorized.
Latest user direction supersedes the historical sequence below: Ukrainian has
5,866 accepted/reviewed keys. Finish only Taiwan Traditional Chinese, then stop
all agents and further languages. Brainstorm a roughly 5× speedup before resuming.
Record wall-clock translation/review/integration/check times; token usage only
when exposed. Measurements: `ui/i18n-context/timing-2026-09-05.json`.
Current roles: Luna direct authoring, Sol one final-product review with correction
counts, Astra concrete complex template repairs. No Astra re-review of Sol.
Three worker slots plus coordinator; complete fixed batches through internal
chunks and resume partial outputs. No browser checks, no repeated full UI suite.

Original plan, requested 2026-09-05. This document superseded the earlier
eight-language scope and parallel-agent execution proposal for this work.
The original planning change did not promote any locale.
Scope is exclusively the interface under `ui/`, with supporting skills and this
plan. Existing in-progress locales (`de`, `fr`, `id`, `ja`) are deferred entirely:
do not translate, review, repair or promote them in this execution.

## Ownership and execution

User validation update: no browser launch, visual walkthroughs or overflow checks
in this expansion; the user handles visual review later. Use fast translation
gates per batch, not the full UI suite. One full UI gate has passed for current
shared source changes (6,209 tests); do not repeat per language without relevant
code changes or required final handoff checks. Upcoming locales reuse identical
fixed 500-key source batches. This overrides visual acceptance requirements below.

Convergence update: Astra fixes review findings directly. Use one independent
review-and-fix pass per Luna batch, with at most one further targeted correction
pass for a concrete unresolved defect. No semantic review of Astra's own fixes
and no recursive correction loops. Mechanical validation follows edits. Unresolved
blockers after the cap remain explicitly in progress. Ukrainian (`uk`) is the next
language after Taiwanese Chinese and uses 500+ key batches.

Latest execution update: user authorizes **two concurrent workers**.
Start fresh subagent contexts after one or
two complete batches. Use disjoint assignments and serialize shared dictionary,
ledger and skill merges; a reviewer can stage approvals while Luna translates.

Execution update: Taiwanese Chinese is now first and uses 300+ key batches.
For the next language and subsequent languages, translation AND review batches
must contain **500+ keys** (user instruction). The smaller final-remainder and
correction-only exceptions remain. Small file edits may build a full batch.

- Luna (`gpt-5.6-luna`) translates and corrects dictionaries using the approved
  glossary, source context and translation merge gate.
- Astra (`gpt-6-astra`) owns source extraction, complex templates, plural and
  formatting infrastructure, locale negotiation, RTL, validation tooling and
  independent review of every translation batch, including existing translations.
- Up to TWO workers run concurrently with disjoint batch ownership. Use fresh
  contexts after one or two batches; the coordinator serializes dictionary,
  ledger, glossary and skill changes. Review may overlap a different translation
  batch; reserve keys before dispatch to prevent duplicate work.
- Each handoff specifies locale, keys/source revision, files changed, checks,
  unresolved issues and skill lessons. Update the applicable skill immediately
  when a reusable lesson is learned, before the next batch or handoff. Put
  locale-specific terminology and examples in its glossary and link from the skill.
- Use the existing `.claude/skills/translate-ui/SKILL.md` and
  `.claude/skills/migrate-i18n/SKILL.md`; explicitly supply these paths to agents.

## Observed baseline

Read-only inventory on 2026-09-05, against the current working tree:
5,862 English keys, of which 5,854 are eligible for translation.
These counts measure key presence, not linguistic correctness or freshness.

| Locale | Eligible keys present | Missing | Release state |
|---|---:|---:|---|
| English `en` | 5,854 | 0 | Production source |
| German `de` | 5,616 | 238 | In progress |
| French `fr` | 5,616 | 238 | In progress |
| Indonesian `id` | 5,616 | 238 | In progress |
| Japanese `ja` | 4,605 | 1,249 | In progress |

The other 25 requested languages have no dictionary yet and are the translation
scope for this execution. Existing in-progress dictionaries are inventory only.
The working tree already contains unrelated changes, including
English source/dictionary work; establish a fresh baseline before implementation.

## Target locales

| Languages | Planned locale identifiers |
|---|---|
| English, Japanese, German, French, Spanish | `en`, `ja`, `de`, `fr`, `es` |
| Portuguese, Italian, Dutch, Polish, Korean | `pt`, `it`, `nl`, `pl`, `ko` |
| Traditional Chinese, Russian, Turkish, Ukrainian, Swedish | `zh-Hant`, `ru`, `tr`, `uk`, `sv` |
| Finnish, Czech, Catalan, Norwegian, Indonesian | `fi`, `cs`, `ca`, `nb`, `id` |
| Hindi, Vietnamese, Arabic, Bengali, Tamil | `hi`, `vi`, `ar`, `bn`, `ta` |
| Telugu, Persian, Hebrew, Thai, Romanian | `te`, `fa`, `he`, `th`, `ro` |

Planning defaults: Portuguese uses one `pt` dictionary with its regional wording
policy settled in the glossary; Norwegian means Bokmål (`nb`, with `no` alias).
Traditional Chinese uses `zh-Hant`, with Taiwan-oriented terminology as a starting
policy. Astra must document regional choices and script/region negotiation before
translation. Icelandic belongs to the old scope and is not added by this plan.

## Phase 1 — Astra: establish a trustworthy work inventory

1. Confirm the 25 target dictionaries still have no progress before starting;
   defer any that have since acquired progress. Audit
   template and TypeScript literals, accessibility labels, validation, errors,
   toasts, page titles and dates. Do not treat historical sprint status as proof.
2. Fix source freshness accounting before relying on it: `i18n-batch` selects
   missing keys only; `i18n-todo` updates stamps when offering work, and merge
   does not stamp accepted translations. An offered key is not a completed review.
   Record source hashes on accepted work, retain unresolved stale entries, and
   distinguish translated from Astra-reviewed revisions. Existing absent stamps
   require review, not an automatic claim of freshness.
3. Complete context for ambiguous strings and prepare glossaries only for the
   new target locales. Keep English-only terminology settings excluded.

Deliverable: current inventory, reliable missing/stale work selection and review
ledger, documented source bugs and reusable skill corrections.

## Phase 2 — Astra: make the shared UI work for every target language

1. Replace sentence fragments, suffix plurals, display-text replacement and
   values glued outside sentences with complete parameterized messages. Preserve
   translator control over word order, including links and emphasis; never use
   unsafe HTML to interpolate user content.
2. Implement and test locale-aware plural selection. The installed wiring does
   not establish an ICU message compiler; choose and verify a supported approach
   before writing ICU syntax into dictionaries. Cover cardinal categories,
   explicit zero if needed, fractions and ordinals where actually used. English
   `.one/.other` selection is insufficient. Derive categories from the runtime,
   rather than reusing the old skill's incorrect Russian category claim.
3. Make numbers, dates, relative time and lists follow the selected UI locale,
   including live switching. `human-time.pipe.ts` still contains English relative
   strings and uses browser-default date formatting.
4. Replace bare-language negotiation where it loses script information. Test
   `zh-Hant`, `zh-TW`, `zh-HK`, explicit `zh-Hans`, Portuguese variants, `nb`/`no`,
   unsupported locales and user-choice precedence. Explicit Simplified Chinese
   must not silently be mistaken for Traditional Chinese.
5. Implement reactive document `lang` and `dir`, RTL layout for Arabic/Persian/
   Hebrew, logical CSS, appropriate icon mirroring and bidi isolation for handles,
   URLs and numbers. Preserve direction of user posts and code independently.
6. Audit font fallback, wrapping and narrow layouts for CJK, Thai and Indic scripts;
   test long German/Finnish strings and mixed-script input. Avoid fixed-width
   assumptions and sentence splitting around markup.
7. Update extraction, merge and validation to support the chosen message schema,
   all locale identifiers and placeholder/markup safety. Add meaningful regression
   tests for these behaviors; run targeted UI tests during the loop.

Deliverable: stable source messages and tested shared infrastructure. Fix this
before multiplying structural defects across 29 translation dictionaries.

## Phase 3 — sequential Luna translation / Astra review

First exercise the infrastructure with representative batches of at least 300
keys in Polish, Arabic, Traditional Chinese and Hindi, each Luna pass followed by Astra.
Include counts, formatted values, rich text, unknown-gender names, long buttons,
warnings and accessibility text. Resolve structural problems before scaling up.

Then complete only the previously unstarted locales in this order:
`zh-Hant`, `uk`, `pl`, `ar`, `hi`, `es`, `pt`, `it`, `nl`,
`ko`, `ru`, `tr`, `sv`, `fi`, `cs`, `ca`, `nb`, `vi`, `bn`, `ta`, `te`,
`fa`, `he`, `th`, `ro`. English is maintained by Astra as the source.

For each locale:

1. Luna drafts/extends its glossary; Astra reviews register, terminology and
   regional policy before bulk translation. Register a new locale as in progress
   so it can be inspected on test/canary.
2. Luna translates coherent batches of **at least 300 keys** using context and the glossary,
   submitting through `i18n-merge`. Group small areas; use flat slices for the
   scattered tail. Prefer larger batches when practical, and assign several
   sequential batches per agent dispatch to amortize setup. Only the final
   remainder below 300 keys or a correction-only pass may be smaller. Astra
   reviews equally large batches; no tiny review dispatches. Include stale work
   from the repaired inventory for locales started by this execution.
3. Luna finishes; Astra independently reads every batch against English and
   actual call sites. Review meaning, reversals, register, grammar, placeholders,
   markup and length. Mechanical checks and trap greps do not replace reading.
4. Astra directly fixes linguistic findings during its one review-and-fix pass.
   Do not launch a review of Astra's own edits. Allow only one extra targeted
   correction pass for a concrete unresolved issue. Astra handles source/template defects during its
   turn and queues affected keys in the new locales for retranslation/review.
   Record impacts on deferred locales without working their dictionaries.
5. Update skills/glossary as lessons arise. Record accepted source hashes and
   reviewed key ranges so a restart does not repeat or skip work.
6. Review all keys produced by this execution. Previously in-progress locales
   remain deferred even if their inventory has gaps or stale entries.

## Phase 4 — Astra: acceptance and release readiness

- All 25 newly completed locales are selectable on review builds with correct
  native names; existing locale exposure is preserved.
- Each newly completed locale has zero unexplained missing/stale eligible keys,
  no unreviewed entries, a completed glossary and reviewed trap findings.
  Intentional exclusions are recorded; unresolved omissions mean in progress.
- Verify locale switching, persistence, English fallback and dictionary loading
  on root, `/test/`, `/canary/` and supported subpath deployments.
- Force every newly completed locale through home/feed, profile, compose, search, settings and a
  connector page on narrow and wide layouts. Exercise error/empty/loading states,
  RTL, keyboard focus and accessible labels. Record results per locale.
- Run `make i18n`, relevant lint/build/subpath checks and the complete UI gate
  `cd ui` then `make test` once before implementation handoff. Targeted runs are
  only edit-loop feedback. Do not weaken tests or coverage to shorten the run.
- Promote only accepted locales from `IN_PROGRESS_LOCALES` to
  `PRODUCTION_LOCALES`, remove in-progress endonym markers, and test the resulting
  registry. Preserve per-key English fallback for future feature development.

Implementation handoff includes changed files, locale completion/review status,
test results, remaining issues and the updated skills. This plan itself changes
documentation only; it does not require running the Angular suite.
