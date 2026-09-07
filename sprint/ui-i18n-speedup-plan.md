# UI translation rollout plan

## Current policy

Sol directly authors translations. There is no separate linguistic-review stage.
Past model benchmarks and reviewer pipelines are historical evidence only and
must not be replayed as current procedure.

Keep the frozen inventory of 5,866 eligible strings divided into eleven 500-key
batches and one 366-key remainder. A model request may cover a smaller,
context-rich slice (normally 150–250 entries) so its JSON fits in one response;
the fixed batch remains the tracking and merge unit. Save checkpoints and resume
them rather than restarting work.

For each locale:

1. Register it as in-progress and enable its accepted ledger.
2. Establish a concise locale glossary anchored in Mastodon/social-app meanings.
3. Prepare immutable explicit-ID manifests from the frozen inventory.
4. Give only the glossary and assigned work-order slice to a fresh Sol author.
5. Assemble a complete batch, validate exact IDs and expand them mechanically.
6. Merge through the source-bound gate and record acceptance, not review.
7. Run coverage, terminology, trap, ledger, and required UI checks. Keep the
   locale in-progress until separately promoted.

Never use external translation, phrase maps, scripted sentence generation,
filler, or untranslated English as completion. Preserve valid partial work after
any interruption. Mechanical checks prove structure and source binding, not
linguistic quality; handoff language must say so plainly.

Historical measurements remain in dated artifacts under `ui/i18n-context/` for
diagnosis. They do not select models, add review stages, or set rollout policy.

Detailed schemas and acceptance invariants are in
[the execution contract](ui-i18n-execution-contract.md).
