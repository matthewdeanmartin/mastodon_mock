# Sprint 3 — Prompt templates, the inference call, and the JSON contract

**Goal:** the plumbing both helpers need and nothing else. Two user-editable prompt
templates, one inference call that asks for a JSON schema, and one place that distrusts the
answer. No search dialog, no tag dialog — sprints 4 and 5.

## The endpoint decision (deviation from the linked doc)

Matthew's notes link the **Responses** SDK. This sprint uses
`POST /api/v1/chat/completions` instead. Reasons, in order:

1. **Structured output is documented against chat completions.** `response_format:
   { type: 'json_schema', json_schema: { name, strict, schema } }`, result at
   `choices[0].message.content`. The equivalent Responses page 404s.
2. **`supported_parameters` — the filter the model picker already uses in sprint 2 — reports
   `response_format` and `structured_outputs`.** Those are chat-completions parameters. So
   the picker's filter and the call it filters *for* are describing the same surface. Using
   Responses would mean filtering on one API and calling another.
3. Both endpoints exist (probed: each returns 401 unauthenticated, not 404), so this is a
   choice between two live options rather than a workaround.

If Responses becomes the better path later, `OpenRouterChat` is one file with one method.

## The JSON contract, and why the guard still ships

Sprint 2 verified that `google/gemma-4-31b-it` advertises `structured_outputs`, so we ask
for a schema — `{ suggestions: string[] }`, `strict: true`, `additionalProperties: false` —
rather than asking for prose and scraping it.

**The guard ships anyway.** `strict` is a request, not a guarantee: it is honoured by the
*provider*, the user can switch to a model that doesn't support it (the picker lets them
uncheck the filter, which surfaces the `:free` variants), and a fenced ```json block wrapping
the object is a normal failure. So `json-suggestions.ts` accepts the object directly, a JSON
string, or a fenced block, and refuses everything else with a message a human can act on.

That file is the only place in the app that treats model output as hostile. Everything
downstream receives a `string[]`.

## Two templates, not four

Matthew: *"There will be 2 prompt templates, both user editable."* Both features are two-pass
(propose → grade → refine), which naively wants four prompts. It gets two: each template
takes a `{{feedback}}` placeholder that is **empty on the first pass** and carries the
grading summary on the second. One prompt to read, one to edit, one to get right.

| Template | Placeholders |
|---|---|
| Search helper | `{{request}}` — the user's prose · `{{feedback}}` — how the last set scored |
| Tag helper | `{{post}}` — the draft · `{{feedback}}` — activity stats for the last set |

Rendering rule: known placeholders are substituted; **unknown ones are left visibly intact**
rather than blanked, so a typo shows up as `{{requst}}` in the preview instead of silently
producing an empty prompt.

## Deliverables

1. **`providers/openrouter/prompt-templates.ts`** — template metadata, the two defaults,
   `renderTemplate()`, and `PromptTemplateStore` (get / set / reset / isCustom). Overrides in
   one unscoped `localStorage` key, sensitivity `setting` — a tuned prompt is exactly what a
   "here is my setup" gist is for. Unscoped to match the connection it belongs to.
2. **`providers/openrouter/json-suggestions.ts`** — `parseSuggestions()`. Pure, heavily
   tested.
3. **`providers/openrouter/openrouter-chat.ts`** — `suggest({ prompt, schemaName, max })`
   → `Promise<string[]>`. Sends the chosen model, the schema, and a low `max_tokens`.
   Maps 401 → disconnect, 402 → "out of credits", 429 → "rate limited" into sentences a user
   can act on. **One retry** without `response_format` (plus an explicit "reply with JSON
   only" line) when a provider rejects the schema outright.
4. **Prompt editor UI** on the OpenRouter connection page — a textarea per template, the
   placeholder list, "Reset to default", and a "customised" marker.

## Acceptance

- Full gate green; `check:storage` classifies the new key.
- Editing a template persists and survives reload; reset restores the shipped text.
- `parseSuggestions` handles: object, JSON string, fenced block, junk, empty list, dupes,
  over-long lists.
- No inference is issued anywhere yet — sprint 3 ships no user-facing LLM call.

## Deviations from the plan as written

- **`suggestionSchema()` lives in `json-suggestions.ts`, not the chat service.** The schema we
  send and the parser that distrusts the reply are two halves of one contract; splitting them
  across files is how they drift apart.
- **The parser accepts more than the schema asks for.** A bare array, and a single-key object
  under any name (`tags`, `queries`), are both accepted — models rename the key constantly and
  the shape is unmistakable. An object with *two* arrays is refused, because then the payload
  is genuinely ambiguous. Entries may also be annotated objects (`{query, why}`), from which
  the first string field is taken.
- **Dedupe is case-insensitive.** The tag helper produces near-duplicates (`Rust`/`rust`)
  constantly, and showing both wastes two of five slots.
- **The prompt editor drafts before saving.** Typing does not write to storage; Save and
  Cancel both exist, and saving the shipped default back counts as a reset so the "Customised"
  marker cannot get stuck on.
- **A literal `{{placeholder}}` cannot be written in an Angular template** — `&#123;` is
  decoded and then re-parsed as interpolation. The component exposes `braced(name)` instead.

## Verified at runtime

19 browser checks, all passing: both templates render and edit; the shipped search prompt
carries the DSL operators; nothing is written to storage until an edit is saved; Cancel
restores; Save persists and marks the template customised; the edit survives reload; the
*other* template is untouched; Reset restores the shipped text, clears storage entirely, and
removes the marker.

## Explicitly deferred

- The two dialogs and the grading round trips — sprints 4 and 5.
- Streaming, tool calls, multi-turn.
- Per-call cost display.
