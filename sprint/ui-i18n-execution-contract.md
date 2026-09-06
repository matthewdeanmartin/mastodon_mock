# Translation preparation and measurement contract

This is preparation for Korean, not a completed speedup or authorization inferred
from an old plan. No translation or pilot ran during the skill cleanup.

## Readiness before dispatch

- Done: replace accumulated coordinator instructions with one current procedure;
  archive the original verbatim under the skill's references directory.
- Done: separate a small worker skill; dispatch fresh contexts with no history.
- Done: define payload, provenance checks, clocks, counters and experiment gates.
- Pending: implement and test the compact adapter described below. Existing
  `i18n-fixed-batches.mjs` emits full keys; `i18n-merge.mjs` consumes full keys.
- Pending: implement counter/event collection and verify it against one existing
  rollout without launching a translation agent. Counter unavailability must be
  explicit; do not run a token-budgeted pilot without working measurement.
- Pending before Korean rollout: glossary, locale registration inspection, and
  `ko` accepted/reviewed tracking. Currently `trackedLocale` in
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

Spawn author Terra-low or reviewer Sol-low with `fork_turns: "none"` and an
explicit effort. Supply absolute paths and a short prompt:

> Use translate-ui-agent at <path>. Role <author|reviewer>, locale <locale>.
> Read <glossary> and <work-order> only, except specific ambiguity call sites.
> Write <output> using the schema in the work order. Deadline <UTC>.
> Preserve checkpoints. Return path, count, status and exact blockers.

One 500-key assignment per context initially. 50–100-entry checkpoints are file
writes, not new dispatches or validation rounds. Coordinator reads summaries,
counts and failure IDs; it does not echo full payloads or translations into its
own context. Reviewer corrects all final messages in one pass. No routine second
linguistic audit by the coordinator. Mechanical checks run at completed-author
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

Retain the speedup plan's pilot: representative fixed 500-key completed-locale
batch, reference answers withheld, Terra-low author and independent Sol-low
review. Target <=4 minutes; hard stop at 6 minutes, 12k combined worker output,
60k uncached input or 1M cached input. Budgets cover continuations and failed
attempts. Permit one continuation within the same ceiling. Root overhead is
reported separately. Sampling can overshoot a ceiling; record actual overshoot
and stop immediately on observation, never claim an exact enforced token cap.

Only advance after coverage, structural correctness, completed independent review
and no known unresolved/provenance blocker. Record payload bytes and actual model
token deltas; do not run an extra verbose-format translation merely to estimate
compression savings. The historical Taiwan resume is not a controlled fresh
500-key baseline, so label comparisons accordingly.

Next is the separately authorized two-batch pipeline experiment from the plan.
Then set a per-language ceiling from measured throughput before Korean rollout.
Do not silently lift budgets, cycle through models, or start a full language as
the experiment. A failed target produces saved work and a concrete bottleneck
report. This preparation changes no pilot or rollout gate into an automatic pass.
