# Anonymous Great — Sprint 3: AI translation

Status: COMPLETE (implemented 2026-07-29; 1900 tests, lint and storage-registry clean). Roadmap: `anonymous-great-0-overview.md`.
Depends on the OpenRouter connection (`openrouter-0-overview.md`, sprints 1–5, all DONE).

## The premise

`POST /api/v1/statuses/:id/translate` needs a token, so `canUseServerActions` takes the 🌐
button away from anonymous readers entirely (`status-card.html:382`). A reader hitting a
language they don't speak, with no way to read it, is exactly the reader this roadmap is
trying to keep. And even signed-in users get nothing when their server has no translation
provider configured — which is most servers.

OpenRouter is already connected. It can translate.

## The new LLM shape: text, not a list

Every LLM call in the app so far returns `{ suggestions: string[] }` under a strict JSON
schema, and `json-suggestions.ts` is the one place that distrusts model output. Translation
breaks that: the answer is prose, and there is no schema to hide behind.

`OpenRouterChat` gains a second method rather than bending the first:

```ts
/** One prompt in, the model's text out. No schema — the answer is prose. */
async complete(options: { prompt: string; maxTokens?: number }): Promise<string>
```

Shares the key check, the URL, the error mapping (`describeFailure` — 401 disconnects, 402
says "top up", 429 says "wait") and `max_tokens` discipline with `suggest()`. Does **not**
share `response_format`, the retry-without-schema path (nothing to drop), or
`parseSuggestions`.

### Guarding a text reply

There is no schema, so the guard is different and it still has to exist:

- **Refuse an empty or whitespace reply** — an error the user can act on, not a blank post body.
- **Strip the preamble.** Models say "Sure! Here's the translation:" and then translate.
  A leading line ending in `:` before a blank line gets dropped. Documented as heuristic,
  because it is one.
- **Cap the length** relative to the input. A "translation" 10× the source is the model
  having a conversation, not translating; treat it as a failure.
- **Never render it as HTML.** The server translation returns HTML and
  `status-card` binds it through the existing markdown/sanitize path. An LLM's output is
  untrusted text and goes in as **text**, full stop. This is the one hard rule in the sprint.

## The button

🤖🌐 — distinct from the server 🌐, because which translator ran is information the reader
should have. The existing "Translated via {{ provider }}" note already establishes that
expectation; AI translation says `Translated by <model> via OpenRouter` and, per the
roadmap's honesty rule, that it may be wrong.

### Anonymous

**Always visible** — per decision 8, a deliberate exception to `openrouter-0-overview.md`
decision 9 ("no upsell, no teaser"). That rule holds where a helper is an *addition* to a
working surface; here there is no other translate button, so hiding it makes the capability
invisible rather than merely unavailable. Written down, with the rule it breaks named.

Unconfigured → a small dialog: *"Translation here is done by an AI model of your choosing.
Connect OpenRouter (your key, your browser, your account) to use it."* + a link to
`/settings/connections/openrouter`. One paragraph, no drip campaign.

### Signed in — three states

`translation-preference.ts`, one localStorage key, sensitivity `setting`, **registry entry
required** (`npm run check:storage`):

| State | Behaviour |
|---|---|
| `ask` | Clicking 🌐 opens a small chooser: *Server translation* / *AI translation*. Remembers nothing unless the user ticks "always". |
| `ai` | 🌐 goes straight to OpenRouter. |
| `server` | **Default.** 🌐 behaves exactly as it does today. |

Default is `server` per decision 7: it is free to the user, already there, and is what they
have today. A new dependency on a paid API is not something a settings default gets to
decide for someone.

When the server translation *fails* (no provider configured — very common), the failure
offers AI as a next step rather than dead-ending. That is the case that will convert people.

### The third prompt template

`prompt-templates.ts` gains `translate`, user-editable and resettable like the other two,
with placeholders `{{text}}` and `{{target}}`. `PromptTemplateId` becomes
`'search' | 'tag' | 'translate'`; `PROMPT_TEMPLATES` gains an entry so the settings editor
picks it up with no template changes (it already `@for`s over the list).

Prompt requirements, learned from the other two: state the output contract (translation
only, no commentary, no quotes around it), tell it to pass through untranslatable content
(handles, hashtags, URLs) unchanged, and tell it to return the text as-is when it is already
in the target language rather than paraphrasing it.

Target language comes from the user's UI language, not a hardcoded `en`.

## Cost honesty

Every other OpenRouter surface in the app shows what a call costs. Translation is per-post
and therefore the first one a user could run up a bill with by clicking around. The
connection page's credits display already exists (`openrouter-credits.ts`); the ask-dialog
mentions that AI translation spends OpenRouter credits, once, in the chooser — not on every
translate.

## As shipped — divergences worth knowing

- **AI translations are a separate type, not a `Translation`.** `AiTranslation { text, model,
  target }` rather than reusing the server's shape. `Translation.content` is HTML that
  `status-card` pipes through `applyMinimalMarkdown` into `[innerHTML]`; giving model output
  the same type would make the unsafe path a plausible mistake. A distinct type means the
  compiler enforces what a comment could only request. The AI text renders in its own block
  with `{{ }}`, and a test asserts an `<img onerror=…>` payload appears as literal text with
  no element created.
- **`htmlToPlainText` lives in `ai-translate.ts`.** Tags come off before the prompt: sending
  markup wastes tokens and invites the model to translate it. Block ends become newlines, or
  the last word of one paragraph fuses to the first of the next.
- **The button visibility rule is narrower than the sketch.** Anonymous: always shown
  (decision 8). Signed in: shown only when OpenRouter is connected **and** the preference is
  `ai` — otherwise the server 🌐 alone is on screen, routed by preference. Two translate
  buttons side by side for someone who chose "always server" would be clutter, not a choice.
- **A bare preamble is returned verbatim, not rejected.** `"Sure! Here it is:"` with nothing
  after it is indistinguishable from a legitimate one-line reply ending in a colon. Stripping
  it needs a heuristic that also eats real content; the cost of not stripping is a visibly
  useless translation the user retries, which beats silently deleting a post body.
- **Target language comes from `ClientPrefs.knownLanguages()[0]`**, falling back to the
  browser locale. Never a hardcoded `en`.

## Files

- `ui/src/app/providers/openrouter/openrouter-chat.ts` — `complete()`.
- **New:** `ui/src/app/providers/openrouter/text-completion.ts` + `.spec.ts` — the text guard
  (preamble strip, emptiness, length ratio). Pure, and the analogue of `json-suggestions.ts`.
- `ui/src/app/providers/openrouter/prompt-templates.ts` — the `translate` template.
- **New:** `ui/src/app/translation-preference.ts` + `.spec.ts` — the three states.
- **New:** `ui/src/app/ai-translate.ts` + `.spec.ts` — render prompt, call, guard, return.
- **New:** `ui/src/app/status-card/translate-choice-dialog/` — the chooser + the anon upsell.
- `ui/src/app/status-card/status-card.{ts,html}` — 🤖🌐, routing by preference, provenance note.
- `ui/src/app/storage-registry.ts` — the preference key.

## Testing

- **`text-completion`**: preamble stripping (and *not* stripping a legitimate first line that
  happens to end in a colon), empty/whitespace rejection, the length-ratio cap, and that
  output is returned as text with no HTML interpretation.
- **`translation-preference`**: default is `server`; each transition persists; a corrupt
  stored value falls back to `server` rather than throwing.
- **`ai-translate`**: prompt renders with `{{text}}`/`{{target}}` filled; an OpenRouter 402
  surfaces the existing "top up" message rather than a generic failure.
- **`status-card`**: anonymous + unconfigured shows the upsell, not a dead button;
  preference `server` leaves today's behaviour byte-identical.

`npx ng test --no-watch`; `npm run check:storage`; `npm run lint`.

## Demo script

1. Anonymous, OpenRouter not connected. Find a non-English post. 🤖🌐 is **there**, and
   explains itself.
2. Connect OpenRouter. Same post, 🤖🌐 → translated, with `Translated by <model>` under it.
3. Sign in. 🌐 still uses the server (default unchanged — the spillover must not be a
   regression). Set *Ask*, click 🌐, pick AI.
4. A post on a server with no translation provider: server translation fails, and the failure
   offers AI instead of dead-ending.
