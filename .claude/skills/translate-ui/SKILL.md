---
name: translate-ui
description: Coordinate Mockingbird UI locale translation, independent review, and source-ledger acceptance. Assigned workers use translate-ui-agent instead.
---

# UI translation coordinator

User scope controls the locale and whether work is preparation, benchmark, or
rollout. Korean (`ko`) is next. Preparation does not start translation or promote
a locale. Read `sprint/ui-i18n-speedup-plan.md` and its linked execution contract.
[Archived history](references/history-2026-09-05.md) is reference-only; load it
only to investigate a specific regression, never as current instructions.

## Prepare once

From `ui/`, run `node scripts/i18n-fixed-batches.mjs` to validate the common
inventory. Preserve fixed batch membership and frozen source/context hashes;
never refresh snapshots to conceal drift. Assign 500 keys except the remainder.
Check locale registration and accepted/reviewed ledger support before rollout.
Dictionary presence alone does not prove completion.

Set a locale glossary before dispatch: register, canonical social-app terms,
wrong senses and verified contextual exceptions. Use established Mastodon terms
where verified. Keep locale-specific guidance out of this skill. Resolve concrete
shared source defects once. Generated English comes from source comments; never
hand-edit it. Do not emit ICU until the runtime supports it.

## Dispatch

Use Terra (`gpt-5.6-terra`, explicit low effort) for direct authorship and a
separate Sol (`gpt-5.6-sol`, explicit low effort) for independent review. Astra
handles concrete complex source/template defects. This skill permits delegation
within the user's active translation or benchmark scope.

Use `fork_turns: "none"`. Supply only the worker skill path, role, locale,
glossary, immutable work order, output path, schema and deadline. No parent
history, old reports, whole dictionaries or author conversation. Initially one
fixed batch per context; at most two if measurements justify it. Normally use
two author slots and one reviewer slot, within the session limit. Review only
frozen completed candidates. Only the coordinator writes shared artifacts.

Do not dispatch compact IDs before the execution contract's adapter exists and
passes validation. Never improvise positional mapping or silently substitute a
verbose protocol in the benchmark.

## Accept once

1. Preserve author checkpoints under ignored `ui/.i18n-work/<locale>/`.
   Check exact assignment coverage and structure once at author completion.
   Partial work is resumable, never accepted as a completed assignment.
2. Independently review every entry once against English/context/glossary.
   Reviewer outputs corrections only. Apply them mechanically and validate the
   final artifact. No semantic self-review, preference-only polishing, or full
   Astra re-review after Sol.
3. Allow at most one targeted repair for a concrete remaining defect. If still
   blocked, preserve work and report; do not restart the review cycle.
4. Serialize writes through `scripts/i18n-merge.mjs` with frozen `--source=`
   snapshots, then stamp exact accepted values with `--reviewed`. Verify locale
   ledger support first. A dry-run checks supplied keys, not full coverage or
   linguistic correctness.

No Google Translate, DeepL, external MT, phrase/token maps, generic filler,
English copies as completion, or reuse justified only by identical English.
Tools package authored text; they do not translate. Inspect worker tool activity
at handoff for prohibited shortcuts. Structural checks cannot prove provenance;
record audit limits honestly and reject observed violations.

## Finish and measure

Follow execution-contract clocks, counter deltas, budgets and stop rules. Keep
coordinating until acceptance or a real blocker. Preserve valid partials across
continuations; never overwrite them with rejected output.

Run one final locale/source-ledger and dictionary audit. Resolve concrete trap
findings without another full semantic pass. No browser or overflow checks for
this expansion. No repeated full UI suite per batch. Follow repository AGENTS.md
for the final UI handoff gate and affected tests after runtime changes; report
those costs separately and include them in delivery time.

Workers never stage files. Keep scratch out of Git and retain resumable artifacts
until acceptance. Report accepted/reviewed counts, blockers, wall time, token
deltas and validation. Do not promote on coverage alone or claim a speedup from
one fast review. Add reusable lessons only when they change a decision; put
incidents in references and vocabulary in the locale glossary.
