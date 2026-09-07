# Translation execution contract

## Roles and scope

The coordinator freezes assignments, dispatches Sol authors, serializes shared
writes, and runs mechanical validation. Authors translate directly. There is no
linguistic reviewer role, reviewer queue, correction-patch round, or reviewed
ledger stamp in this workflow.

## Immutable work orders

The fixed batch manifest binds locale, batch ID, validation-policy hash, and each
record's explicit ID, dotted key, English, context, optional parameters, and
source hash. Never regenerate a manifest to hide drift or infer IDs by position.

Author output uses explicit pairs so JSON parsing cannot discard duplicate keys:

```json
{"manifestHash":"sha256:…","entries":[["b001-001","authored text"]]}
```

A request may assign a contiguous 150–250-ID slice of a fixed batch. Checkpoints
may be smaller. A candidate is complete only when every manifest ID appears
exactly once and no unknown ID appears.

## Mechanical acceptance

Validate the manifest against current English, context, and policy. Expand IDs
to full dotted keys deterministically. Merge only through
`scripts/i18n-merge.mjs` with the frozen source snapshot. Reject malformed values,
incomplete coverage, duplicates, unknown IDs, wrong locale, drift, placeholder
or markup drift, length-budget failures, and locale-rule failures.

The merge records accepted source and translation hashes. Do not pass
`--reviewed`; absence of a reviewed stamp is intentional. A targeted repair may
change only an entry named by a failed mechanical gate, then rerun that gate.

## Authorship and provenance

Use `gpt-5.6-sol` for direct authorship. Do not substitute another model or add a
semantic review pass. Authors receive the worker skill, locale glossary, and
immutable work-order slice only. No network services, external MT, phrase maps,
substitution generators, generic filler, or copying reference locales. Tool logs
can reveal an observed shortcut but cannot prove network isolation.

## Completion

Run exact locale/source/accepted-ledger coverage, dictionary checks, terminology
checks, locale traps, and the UI gate required by `AGENTS.md` for registration or
runtime changes. Report directly authored and mechanically accepted counts—not
reviewed counts. Full coverage does not authorize production promotion.
