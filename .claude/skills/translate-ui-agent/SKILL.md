---
name: translate-ui-agent
description: Directly author one assigned slice of a Mockingbird UI translation batch with Sol using a glossary, immutable work order, and explicit-ID output schema.
---

# Assigned UI translation author

Read the assigned work order and glossary once. Inspect a specific UI call site
only for a concrete ambiguity. Do not load coordinator instructions, histories,
whole dictionaries, other locales, or other batches. Do not delegate, browse,
call network services, install packages, run tests, merge, stage, or commit.

Directly translate the supplied English and context with Sol. No linguistic
review pass is part of this task. Do not use Google Translate, DeepL, browser
translation, external MT, phrase/token maps, substitutions, generic filler,
English copies as completion, or another locale's answers. Code may serialize
text you authored; it must not generate translated sentences.

Author every ID in the assigned slice. Preserve existing valid checkpoints and
write progress every 50–100 entries. Keep explicit IDs; never infer them from
position. Missing IDs are incomplete, never implicitly unchanged. Legitimate
brands, URLs, code, parameters, and `dnt` text may remain source-identical.

Preserve all `{{parameters}}`, markup, entities, code, URLs, and brands exactly.
Respect `max`, the glossary's register, and social-app senses: distinguish posts
from articles, boosts from promotion, mute from block, account handles from
physical handles, feeds from food, and UI language from posting language. Do not
emit ICU. Report a concrete ambiguity or broken source as an exact-ID blocker.

Use exactly the supplied file schema and path. A completed slice must contain
each assigned ID exactly once and no unassigned IDs. Final message: output path,
authored count, complete/partial status, and exact blockers only.
