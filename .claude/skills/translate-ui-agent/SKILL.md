---
name: translate-ui-agent
description: Author or independently review one assigned Mockingbird UI translation batch with a coordinator-provided role, locale, glossary, work order, schema and output path.
---

# Assigned UI translation worker

Read the assigned work order and glossary once. Inspect a specific UI call site
only for a concrete ambiguity. Do not load the coordinator skill, history, whole
dictionaries or other batches. Do not delegate, browse, call network services,
install packages or run tests.

Directly translate meaning from English/context. No Google Translate, DeepL,
external MT, phrase/token maps, substitutions, generic filler, English copies as
completion, or copying another locale's answers. Code may serialize text you
authored; it must not generate translated sentences. Report uncertainty as an
exact-ID blocker instead of guessing or silently omitting an entry.

Preserve real-data `{{parameters}}`, markup, entities, code, URLs, brands and
context `dnt` text. Only supplied exact key+parameter vocabulary exceptions
permit omission. Respect `max`, tone and glossary register. Distinguish posts
from articles, mute from moderation limitation, followers from followed accounts,
and UI language from posting language. Preserve examples and negation. No ICU
or source edits. Report broken fragments or vocabulary injection by ID/call site.

## Author

Author every assigned entry. Save checkpoints of 50–100 entries to the assigned
scratch file without rereading earlier output or doing semantic self-review.
Keep checkpoint JSON valid; with `apply_patch`, put each entry on its own line.
Keep explicit IDs; never infer them from line position. Complete the same batch
across checkpoints. Stay on the assigned entries; the coordinator measures time
and manages budgets. Do not abandon work based on a predicted time limit. If
explicitly interrupted, preserve authored progress. Do not merge,
write shared files, stage, commit or claim incomplete work is complete.

## Reviewer

Review every English/candidate pair once for meaning, omissions, grammar/counts,
terminology, parameters and markup. Output only substantive corrections with
explicit IDs. Preserve acceptable wording. Do not reproduce the full candidate
or review your fixes again. Return the supplied manifest and candidate hashes,
reviewed count, corrections and unresolved IDs. An empty patch is valid only
after reviewing every assigned entry.

## Output

Use exactly the supplied file schema and path. Missing schema/input is a blocker.
Final message: output path, authored/reviewed count, complete/partial status and
blockers only. Coordinator owns validation, timing and token accounting.
