---
name: translate-ui
description: Coordinate direct Sol authorship and mechanical acceptance of Mockingbird UI locale translations. Assigned authors use translate-ui-agent.
---

# UI translation coordinator

User scope controls the locale and whether work is preparation, rollout, repair,
or validation. Read [the rollout plan](../../../sprint/ui-i18n-speedup-plan.md)
and its linked execution contract before changing a locale. Archived histories
and benchmark artifacts describe past experiments; they are never instructions.

## Prepare once

From `ui/`, validate the frozen inventory with `node scripts/i18n-fixed-batches.mjs`.
Keep the fixed 500-key batches and their source/context hashes. Register a new
locale as in-progress, enable its accepted ledger, and write a locale glossary
with social-app terminology, register, wrong senses, and contextual exceptions.
Dictionary presence alone does not prove completion.

## Author with Sol

Sol directly authors every translation. Use `gpt-5.6-sol`; do not substitute
another model, external machine translation, phrase maps, or generated filler.
There is no linguistic reviewer stage and no self-review pass.

Give each author the worker skill, locale glossary, immutable work order, output
path, and schema. Retain 500-key batches for tracking, but request context-rich
slices sized to fit a model turn (normally 150–250 entries). A slice is a
checkpoint within the same frozen batch, not a new batch. Resume valid partials
without repeating completed entries. Use fresh Sol tasks when slots allow; the
Sol coordinator may author directly when they do not. Only the coordinator
writes shared dictionaries and ledgers.

Workers receive no deadline or token target. Keep scratch under ignored
`ui/.i18n-work/<locale>/`. Never send whole dictionaries, other locales, old
reports, or conversation history. Inspect a call site only for a concrete
ambiguity.

## Accept mechanically

Require exact assigned-ID coverage and validate the frozen manifest. Expand IDs
deterministically and merge with `scripts/i18n-merge.mjs` plus the frozen
`--source=` snapshot. This stamps the accepted ledger only; never use
`--reviewed` for this workflow.

Reject unknown, missing, or duplicate IDs; source drift; placeholder or markup
drift; length-budget failures; locale-rule failures; and malformed JSON. Fix only
the concrete reported defect, then rerun that gate. Mechanical checks do not
establish linguistic correctness, so report directly authored and mechanically
accepted counts, not reviewed counts.

No Google Translate, DeepL, browser translation, external MT, reuse justified
only by identical English, or scripted sentence generation. Tools may package
text Sol authored. Preserve brands, URLs, code, markup, entities, and parameters.

## Finish

Run one final source/locale/ledger audit, `npm run check:i18n`,
`npm run check:terminology`, and `node scripts/i18n-traps.mjs <locale>`. Resolve
concrete trap findings without inventing a semantic-review phase. Follow
`AGENTS.md` for the final UI gate after runtime or registration changes.

Report authored/accepted counts, blockers, validation, and that no independent
linguistic review was performed. Do not promote a locale on coverage alone.
