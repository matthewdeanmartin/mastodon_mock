# UI translation speedup plan

Status: user removed deadline pressure and switched authorship back to Luna-low.
Terra authored 400 entries before the requested interruption; Luna completes the
100 remaining entries. A separate Terra reviews the completed 500-key batch.
The mixed authorship result must not be reported as a clean model comparison.
The first Korean 500-key benchmark failed: Luna returned
500 exact English copies, zero Korean translations. Nothing was merged and no
Terra/Astra linguistic review was dispatched. See
`ui/i18n-context/benchmark-ko-2026-09-06.json`. The run followed explicit
user direction to use Luna authoring, Terra review, and Astra whole-locale review
only after all Korean strings are done. The coordinator
skill is `.claude/skills/translate-ui/SKILL.md`; the isolated worker version is
`.claude/skills/translate-ui-agent/SKILL.md`. Implementation readiness and precise
measurement rules are in [the execution contract](ui-i18n-execution-contract.md).
The targets below remain unproven. Ukrainian and Taiwan Traditional Chinese are complete
(5,866 accepted/reviewed keys each). Benchmark results and actual counters are
recorded separately; the earlier completed locales are unchanged.

## Target and measured baseline

Aim for roughly 5× lower end-to-end wall time, with substantially less token
consumption. This is an acceptance target, not a demonstrated result.

The measured Taiwan finish took **28m 29s**: 1,666 additional keys accepted and
reviewed, plus 98 targeted repairs to earlier translations. It was a resume with
saved drafts, not a complete new-language benchmark. Ukrainian's full runtime
was not reliably measured. The user's reported roughly 30% weekly allowance
consumption covers more work than this timed segment.

| Observed work | Time/result |
|---|---|
| Sol review of 699 saved/repair entries | 92s reported review time; 110 changed |
| Luna author A, medium effort | 9m 04s observed; stopped at 498/500 after continuations |
| Luna author B, medium effort | Rejected phrase-mapped draft; zero accepted output |
| Sol author attempt, low effort | Finished A's final 2 keys; did not author B |
| Terra author B, explicit low | 6m 46s observed across two turns; all 565 completed |
| Sol review A, low | 2m 20s reported; 12 changed |
| Sol review B, explicit low | About 3m observed; 4 changed |
| Each serialized merge and review stamp | About 4–6s |

Observed task intervals include setup/continuation gaps; reported review intervals
start when reviewers took their clock reading. Do not add concurrent durations
and call that elapsed wall time.

The frozen local counters for the timed finish record about **17.54M input tokens,
of which 17.05M were cached**, plus **93.9k output tokens**. That is approximately
482.9k uncached input tokens. Reasoning output is included in output, not added
again. These are token counters, not monetary cost or a conversion to weekly
allowance. About 25.9k output tokens came from the coordinator itself; reducing
orchestration overhead belongs in the plan too.

Evidence: `ui/i18n-context/timing-2026-09-05.json`, `usage-2026-09-05.json`, and
`review-zh-Hant-resume-2026-09-05.md`.

## Changes before another rollout

1. **Use Luna-low to author and a separate Terra-low to review.** User selected
   this pairing after removing deadline pressure. After the entire Korean
   locale is translated and Terra-reviewed, Astra reviews all 5,866 eligible
   strings once. Do not run Astra linguistic reviews between batches. Set effort
   explicitly. No external machine translation or phrase mapping.

2. **Shrink the worker brief and payload.** Replace the long, contradictory
   history in the skill with one current procedure; archive past incidents in
   reference notes. Give workers only that brief, the relevant glossary and their
   fixed work order. No parent dialog, translator dialog, unrelated files or
   repeated full skill reads. Keep one or two batches per context.

3. **Stop making models repeat long dotted keys.** Introduce a source-bound
   manifest with explicit short stable IDs. For example, the model returns
   `{"b10-042":"發佈"}` and a deterministic helper resolves that ID to the full
   key. IDs must be explicit, never inferred from line position. The helper only
   packages authored text; it never generates, substitutes or translates it.
   Reject unknown/duplicate/missing IDs, source drift and parameter/markup drift.
   Preserve an auditable full-key final dictionary. Measure the actual output-token
   saving in the pilot rather than assuming a percentage.

4. **Keep 500+ key assignments, but checkpoint inside them.** Retain the identical
   fixed source batches across languages. Internal 50–100 entry file writes are
   checkpoints, not new assignments, tests or review rounds. Persist authored
   progress immediately; never restore rejected text over it. The coordinator
   resumes valid partial output within the same assignment, without replanning
   the work. Exact assigned-key equality is mandatory before review.

5. **Review every final message once and output corrections only.** Terra receives
   English, necessary context, glossary and the completed candidate—not the
   author's conversation. Review meaning, omissions, grammar/counts, terminology,
   placeholders and markup. Inspect code only for a specific ambiguity. Return
   an explicit-ID correction patch plus reviewed count and manifest hash; tools
   preserve unchanged values. No preference-only polishing, no per-batch Astra pass,
   no semantic self-review. Astra's requested whole-locale pass occurs only after
   all Korean strings finish Terra review. At most one targeted repair for a concrete
   remaining defect. Lower changed-string counts are not proof of better review.

6. **Keep three worker slots productive with disjoint work.** Normally two
   authors and one reviewer; when authoring finishes, use freed slots for
   independent reviews. Review can overlap another batch's authoring, but never
   inspect a file still being authored. Only the coordinator writes shared
   dictionaries/ledgers. Replace finished workers promptly; do not end the active
   coordination turn after dispatch. Do not work around the session's slot limit.

7. **Do shared preparation once.** Resolve known English-vocabulary injection
   and sentence-fragment classes in the common source before multiplying them
   across languages. Reuse a verified manifest and checks. Reuse translations
   only when source and contextual meaning are proven identical; identical
   English words alone do not establish that. Do not turn this into an unlimited
   template redesign. Record one-time preparation separately from per-language time.

8. **Keep validation proportional.** One fast structural check per completed
   batch and one final locale/source-ledger audit. No browser tests or overflow
   checks. No full UI suite per batch or per language. Run affected existing unit
   tests once only for actual template/runtime changes.

## Clock, token budget and stop rules

Use coordinator timestamps at dispatch, first saved output, author completion,
review start/end, merge and validation. Record queue/idle time and continuation
count. Read effective model/effort and token-counter deltas from local rollout
metadata; keep cached input, uncached input, output and reasoning subsets separate.
Do not trust a worker's final ten-second timer as its entire task duration.

For the first pilot, use Korean fixed batch 001 (**500 keys**, 111 parameterized
messages and 15 messages longer than 120 characters). Keep valid work for the
Korean rollout. Benchmark the compact format with Luna-low authoring and an
independent Terra-low review. Do not use a whole language as the initial experiment.

Historical proposed pilot targets (diagnostic only after the user's deadline correction):

- End-to-end authoring plus review: **4 minutes or less**; former cutoff **6 minutes**.
- Combined author/reviewer output: **12k tokens or less**.
- Combined uncached input: **60k or less**; cached input: **1M or less**.
- Exact coverage and structural checks pass; all substantive review findings fixed
  within the single review pass, with no known blocker or prohibited shortcut.

The user identified deadline pressure during the second experiment. The figures
above have no successful end-to-end baseline and now serve as reporting thresholds,
not automatic cutoffs. Do not put them, a deadline or 'finish promptly' in worker
prompts. Workers stay on scope and save progress; coordinator owns measurement.
The historical Terra author alone took 6m 46s. This pilot's Terra initial context
already used about 47k uncached tokens before review, so a 60k combined ceiling
cannot be assumed realistic.

Check counters at handoffs and at least once a minute. Bound the pilot to one fixed
assignment, one independent review, one partial continuation and at most one
targeted repair. Stop on a prohibited shortcut, a worker returning zero useful
authorship, or an unresolved blocker. Investigate actual progress before treating
elapsed time as a stall. Save valid work and report actual costs and overruns;
do not cycle through models or retry all day.

If the pilot passes, the next separately authorized test is two disjoint batches
through the three-worker pipeline. Measure the complete critical path. The 5×
target for work comparable to the Taiwan resume is approximately **5m 42s**;
that cannot be established by multiplying a single fast review rate. If the
pipeline misses, stop and revisit payload size, model choice or available
concurrency before another language rollout. No automatic budget increases.

After passing both gates, estimate a full language from measured throughput and
approve a per-language time/token ceiling. Stop and report any overrun. A 5×
gain may require more than the current three-worker capacity; do not promise it
or silently trade away full independent review to obtain it.
