# Translation preparation and measurement contract

User's latest direction: Luna-low authors without deadline pressure and a separate
Terra-low agent reviews. The Terra author experiment was interrupted on request
after 400 saved entries; Luna completes the remaining 100 in the same batch,
and Astra reviews the entire Korean locale only after all strings finish those
stages. The first pilot uses Korean batch 001. No translation ran during the
earlier skill cleanup; this run measures implementation preparation separately.

## Readiness before dispatch

- Done: replace accumulated coordinator instructions with one current procedure;
  archive the original verbatim under the skill's references directory.
- Done: separate a small worker skill; dispatch fresh contexts with no history.
- Done: define payload, provenance checks, clocks, counters and experiment gates.
- Done: `ui/scripts/i18n-compact.mjs` prepares immutable manifests, exports compact
  work orders, binds correction patches, and expands full-key merge inputs.
  Five targeted tests pass; partial checkpoints cannot pass as complete.
- Done: `ui/scripts/i18n-metrics.mjs` captures effective model/effort, cumulative
  counters, reset-aware deltas and coordinator events. Four tests pass and an
  existing rollout was read successfully before launching the author.
- Done: Korean glossary established with a Mastodon vocabulary anchor.
- Pending before Korean rollout: registration and `ko` accepted/reviewed tracking.
  Currently `trackedLocale` in
  `ui/scripts/i18n-ledger.mjs` contains only `zh-Hant` and `uk`.

## Compact adapter contract

Keep the fixed inventory authoritative. Coordinator generates an immutable
manifest with version, locale, batch ID, source/context hashes, validation-policy
hash, and records `{id,key,english,context,optionalParameters}`. Assign explicit
IDs such as `b001-001` once from frozen batch membership. Hash the canonical
manifest, including all fields; do not regenerate it after dispatch. Worker
payload retains English and necessary context but omits full dotted keys when
their meaning is already conveyed by context. Keep a compact semantic hint when
the key is the only disambiguator. Deduplicate repeated context by explicit
reference, never by removing meaning. Full-key mapping stays with coordinator.

Use arrays of explicit pairs for model output, so ordinary JSON parsing does
not silently discard duplicate object keys:

```json
{"manifestHash":"sha256:…","entries":[["b001-001","authored text"]]}
```

At author completion freeze the candidate and hash its exact bytes. Review input
contains ID, English, context and candidate together, plus glossary; reviewer
never reads the author's dialog. Review output:

```json
{"manifestHash":"sha256:…","candidateHash":"sha256:…","reviewedCount":500,"corrections":[["b001-001","corrected text"]],"blockers":[]}
```

Reject wrong manifest/candidate hashes, duplicate/unknown IDs, malformed values,
incomplete authorship, incorrect review count, and source/context/policy drift.
Missing review correction IDs mean unchanged; missing author IDs mean incomplete.
Patch only the frozen candidate; expand to full-key JSON deterministically and
use existing placeholder/markup/max/locale gates. Never generate translated text.
Check exact assignment equality independently of merge dry-run. Stamp review
only for the exact final values produced by that review and accepted merge.

Adapter tests must exercise duplicate/missing/unknown IDs, stale source/context,
wrong locale, stale candidate review, policy drift, partial checkpoints, empty
correction patches, unchanged-value preservation and full-key round trip. Use
synthetic text, not translation agents, for implementation tests.

## Minimal dispatch

Spawn author Luna-low or reviewer Terra-low with `fork_turns: "none"` and an
explicit effort. Supply absolute paths and a short prompt:

> Use translate-ui-agent at <path>. Role <author|reviewer>, locale <locale>.
> Read <glossary> and <work-order> only, except specific ambiguity call sites.
> Write <output> using the schema in the work order. Stay on the assigned entries.
> Preserve checkpoints. Return path, count, status and exact blockers.

One 500-key assignment per context initially. 50–100-entry checkpoints are file
writes, not new dispatches or validation rounds. Coordinator reads summaries,
counts and failure IDs; it does not echo full payloads or translations into its
own context. Reviewer corrects all final messages in one pass. No routine second linguistic audit per batch; the user requests one Astra review after all Korean strings pass Terra review. Mechanical checks run at completed-author
and patched-final boundaries; later checks require a changed artifact or failure.

## Provenance without pretending to enforce a sandbox

Workers are instructed to use no network and no external translation. Coordinator
checks their task-local tool activity at each handoff for HTTP/browser/MT calls,
phrase maps, substitution generators and copying reference translations. Record
the audit result and exact evidence path, without importing transcripts into the
reviewer's context. Reject observed shortcuts; preserve legitimate partial work.
Review still checks actual meaning across every entry, because filler can pass
structural checks. Instructions and tool-log inspection are not network isolation
or proof of direct authorship. Record hidden/unavailable tool activity as unknown,
not as verified clean provenance. Do not claim a technical Google Translate block.

## Event record and calculations

Save durable run summaries under `ui/i18n-context/`; scratch payloads live in
ignored `ui/.i18n-work/<locale>/`. Give each run a unique ID. Capture repository
revision and dirty-diff hash, source manifest/policy hashes, scope, key count,
requested/effective model and effort, agent/session IDs, and event records:

`{runId,batchId,agentId,stage,event,atUtc,observedAtUtc,counterSnapshot,artifactHash}`.

Events: preparation start/end, ready, dispatch, first saved output, author
complete, review dispatch/start/end, patch applied, merge start/end, validation
start/end, continuation, rejection, stop and delivery. Coordinator timestamps
are authoritative. File-write event time measures first save where available;
otherwise record first observed time as an upper bound, not an exact first save.

Read only relevant rollout metadata and `token_count` events. Baseline each
session before dispatch and sample at handoffs and at least every 60 seconds.
Use cumulative counter deltas, not the sum of cumulative snapshots. Retain
input, cached input, output and reasoning output separately. Compute uncached
input = input - cached input; reasoning is already included in output. Record
resets/session changes as separate segments and aggregate each once. Track root
delta separately, including failed attempts and coordination; do not attribute
earlier conversation usage to this run. Missing values are null, never zero.

Report critical-path wall time from first dispatch through final validation,
worker intervals, queue time (ready to dispatch), author-to-review wait,
coordinator merge delay, continuation count and rejected keys. Distinguish
one-time preparation, benchmark work, per-language work, final repository gates,
and total request-to-delivery time. Never sum concurrent durations as wall time.
Report accepted-and-reviewed keys per minute and token totals, not generated
keys as successful throughput. Byte/character reductions are not token savings.

## Experiment gates

Use the first fixed 500-key Korean batch, preserving valid authored work, Luna-low
author and independent Terra-low review. User corrected deadline pressure during
the second pilot. Workers receive scope and focus instructions, not deadlines,
speed demands or token ceilings. Coordinator samples progress and usage at least
once a minute and records the intervention; this is no longer a model-only comparison.

The earlier 4-minute target, 6-minute stop, 12k worker output, 60k uncached input
and 1M cached input were proposals without a successful end-to-end baseline.
They are diagnostic thresholds, not automatic cutoffs for this experiment.
Terra's earlier 565-key authorship alone took 6m 46s; the second pilot's initial
author context used about 47k uncached tokens before review. Do not present these
targets as demonstrated capacity or pressure workers to satisfy them.

Bound this experiment by one fixed assignment and one independent review. Allow
one continuation of valid partial authorship and at most one concrete targeted
repair. Stop on prohibited shortcuts, a completed worker return with zero useful
authorship, or an unresolved blocker. Preserve work. Inspect an apparent stall
before interrupting; time alone does not establish a stall. Root overhead remains
separate. Report all actual tokens, threshold overruns and failed attempts.

Only advance after coverage, structural correctness, completed independent review
and no known unresolved/provenance blocker. Record payload bytes and actual model
token deltas; do not run an extra verbose-format translation merely to estimate
compression savings. The historical Taiwan resume is not a controlled fresh
500-key baseline, so label comparisons accordingly.

If the first pilot passes, next is the two-batch pipeline experiment from the
plan, within the user's authorized Korean work. Establish realistic coordinator
ceilings from observed completed throughput before Korean rollout.
Do not cycle through models or start a full language as
the experiment. A failed target produces saved work and a concrete bottleneck
report. This preparation changes no pilot or rollout gate into an automatic pass.
