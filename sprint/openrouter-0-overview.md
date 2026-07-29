# Roadmap — OpenRouter connection, model picker, and LLM prompt helpers

Status: PLANNED (2026-07-28). Multi-sprint roadmap; execution starts with sprint 1
(catalog + RSS move). Decisions below are answered — see "Decisions taken".

## The pitch

Mawkingbird gets one LLM connection — OpenRouter — and spends it on two small, sharply
scoped features that make the app better at the two things it is worst at:

- **Searching.** The Mastodon search DSL is real and powerful (`from:`, `has:media`,
  `-is:reply`, `before:`/`after:`, `language:`, `in:public` — see
  `sprint/search-2-serializer-and-explain.md`) and nobody knows it exists. You should be
  able to type *"posts from my friend about rust compilers last month"* and get five
  runnable DSL queries back.
- **Tagging.** Hashtags are how discovery works on Mastodon and picking good ones is a
  skill. The compose box should be able to suggest tags that *actually have activity*.

Both features share the same shape, and that shape is the interesting part:

> **The LLM proposes, the Mastodon API grades, the LLM revises — but only if the grades
> are bad.** A second round trip is a cost, not a ritual.

Non-goals (explicitly out of scope):

- A chat UI. We have `eliza/` for the toy-chatbot itch; this is not that.
- Streaming responses. Both features return a small JSON list. Nothing to stream.
- Multiple LLM providers. OpenRouter *is* the multi-provider layer — that's the point of
  picking it. One connection, hundreds of models.
- Content generation. The LLM never writes a post. It suggests queries and tags, which the
  user edits before use. Every dialog ends in a user-editable textarea, never an auto-apply.
- Any Mawkingbird backend. Everything stays client-side + localStorage, as always.

## Reality check: what the browser can and can't do

| Endpoint | Browser-callable? | Auth | Notes |
|---|---|---|---|
| `https://openrouter.ai/auth` | n/a (top-level navigation) | none | PKCE authorization step |
| `POST /api/v1/auth/keys` | yes | none (code + verifier) | returns a real `sk-or-v1-…` key |
| `GET /api/v1/models` | yes | none | public; ~500 models, big payload |
| `GET /api/v1/key` | yes | the user's key | usage / limit / limit_remaining |
| `GET /api/v1/credits` | yes | **management key only** | see the credits trap below |
| `POST /api/v1/responses` | yes | the user's key | the actual inference call |

OpenRouter sends permissive CORS headers on `/api/v1/*`, so unlike RSS there is no
machinery problem here. The problems are all policy problems.

### The credits trap (read this before building sprint 2)

The docs page Matthew linked — *Get remaining credits*, `GET /api/v1/credits` — **requires a
management (provisioning) key**, not an inference key. The key PKCE hands us is an
inference key. Calling `/api/v1/credits` with it returns 403.

The endpoint that works with a PKCE-obtained key is `GET /api/v1/key`, which returns
`usage`, `usage_daily/weekly/monthly`, `limit`, and `limit_remaining` for the calling key.

Design consequence, and it is not just a fallback: **`limit` is frequently `null`** (a key
with no spending cap). "Credits remaining" is therefore a *three-state* display, not a
number:

| State | Source | Display |
|---|---|---|
| Key has a spending cap | `limit_remaining` | `"$4.12 of $10.00 remaining"` |
| Key has no cap | `usage` only | `"$5.88 used · no cap on this key"` |
| Management key pasted (post-MVP) | `/api/v1/credits` | `"$74.25 of $100.00 remaining"` |

Sprint 2 implements the first two and probes `/api/v1/credits` opportunistically, treating
403 as "not a management key" rather than an error worth showing.

### The `state` gap

OpenRouter's authorization step takes `callback_url`, `code_challenge`, and
`code_challenge_method` — and **no `state` parameter**. Every other OAuth flow in this app
(`src/app/pkce.ts` `createOAuthState` / `statesMatch`) leans on `state` to bind the callback
to the flow this browser started.

We do not get to skip that. The mitigation: **put our own `state` in the `callback_url`
query string** (`…/integrations/openrouter/callback?state=<random>`) and verify it on return
exactly as `DropboxSession.finishAuthorization` does. OpenRouter appends `code` to whatever
callback URL we give it, so our parameter survives the round trip. If a future OpenRouter
change strips unknown query params, the state check fails closed — which is the correct
direction to fail.

## Decisions taken (from Matthew, 2026-07-28)

1. **Hand-roll `fetch`; do not add `@openrouter/sdk`.** `ui` has five runtime dependencies
   and every connector in `providers/` (Dropbox, GitHub, Bluesky, Raindrop) is hand-rolled
   `fetch` over the vendor's REST API. Four endpoints do not justify reversing that, and the
   SDK is Node-oriented in a browser-only, serverless app. `OpenRouterSession` keeps the same
   shape as `DropboxSession` so the calls stay swappable if this ever stops being true.
2. **The OpenRouter key is governed by `CredentialLifetimeStore`.** It is long-lived with no
   refresh token and no natural expiry — the GitHub/Raindrop class, not the Dropbox class.
   It goes in `localStorage`, stamped via `stampCredential`, registered `secret` in
   `storage-registry.ts`, and `OpenRouterSession` implements `ExpiringConnection`.
   The connections page adds it to the `lifetimes.govern([...])` list.
3. **Catalog first on the Connections tab.** The tab currently renders six stacked `<section>`
   forms in one 363-line template and adding a seventh is untenable. It becomes a catalog of
   cards — name, one-line pitch, what it *enables*, connected/not-connected — and each entry
   routes to its own child page. See sprint 1.
4. **RSS leaves Connections for its own settings tab.** A connection is one account; RSS is
   *many* feeds with their own list management. It was only ever on Connections because
   that's where it was born.
5. **Two prompt templates, both user-editable, both with a visible "reset to default".**
   Stored in localStorage, `setting` sensitivity — a tuned prompt is exactly the kind of
   thing worth publishing in a setup gist.
6. **Default model is Gemma** — `google/gemma-4-31b-it`, verified live. It supports
   `structured_outputs`, which is what makes the JSON contract in sprint 3 a schema rather
   than a prayer.
7. **The model list is only ever returned filtered.** No unfiltered browse mode at all.
   `GET /api/v1/models` supports server-side `q`, `supported_parameters`, price and context
   filters; the picker is a search box, not a catalog of 500.
8. **The OpenRouter key is global to this browser, not scoped to a Mastodon account.**
   A Bluesky link belongs to the persona that made it; an LLM key belongs to the human and
   works the same signed in, signed in as an alt, or Anonymous. This is the app's first
   deliberate exception to `scopedKey()` — see sprint 2 §5 for the three consequences.
9. **Helper buttons are hidden when OpenRouter isn't connected.** No upsell, no teaser.
   Connections are a power-user surface and power users find the Connections tab.
10. **Grading is short-circuited, not exhaustive** (Matthew, 2026-07-28, superseding the
   original "grade all five" rule). Try suggestions **in order and stop at the first that
   succeeds** — the prompt already returns them most-likely-first, so the first one that
   works is also the most specific one that works. Cost drops from 5 API calls every time to
   1 in the common case. The refine round trip then has a sharper trigger: it fires only when
   **everything** failed, which is exactly the case where the model misunderstood.
   Thresholds live in one named constant each, not scattered at the call site.

## Sprints

| # | File | Theme | Ships | Risk |
|---|---|---|---|---|
| 1 | `openrouter-1-catalog-and-rss-tab.md` | Connections becomes a catalog; RSS moves to its own settings tab | ✅ **DONE** 2026-07-28 | none — pure refactor of existing code |
| 2 | `openrouter-2-pkce-and-models.md` | `OpenRouterSession` (PKCE), connection detail page, model picker, credits | ✅ **DONE** 2026-07-28 | PKCE `state` gap; credits three-state |
| 3 | `openrouter-3-prompt-templates.md` | `PromptTemplateStore`, template editor UI, chat-completions call + JSON-shape guard | ✅ **DONE** 2026-07-28 | LLM returns non-JSON — contained by a strict parser + one retry |
| 4 | `openrouter-4-search-helper.md` | Search helper dialog: prose → 5 DSL queries → **try in order, stop at first success** → conditional refine | ✅ **DONE** 2026-07-28 | Grading cost, solved by short-circuiting: 1 call typical, 5 worst case |
| 5 | `openrouter-5-tag-helper.md` | Tag helper dialog on compose: post → tags → activity check → conditional refine | Feature 2 | none new |

Sprint 1 is deliberately first and deliberately boring: sprints 2–5 each add UI to the
Connections tab, and doing them on top of the current 363-line template would mean building
the catalog anyway, later, with more to move.

Sprints 4 and 5 are independent of each other once 3 lands.

## Files that will change (map for all sprints)

**Sprint 1**

- `ui/src/app/pages/settings/connections/settings-connections.{ts,html,css}` — becomes the catalog.
- **New:** `ui/src/app/pages/settings/connections/connection-catalog.ts` — the catalog entries
  (id, label, emoji, pitch, enables[], route, `connected: Signal<boolean>`).
- **New:** `ui/src/app/pages/settings/connections/{github,dropbox,raindrop,bluesky}/` — one
  child page each, lifted verbatim from the current template.
- **New:** `ui/src/app/pages/settings/rss/settings-rss.{ts,html,css}` — the RSS tab.
- `ui/src/app/pages/settings/settings-shell.ts` — nav gains "RSS feeds".
- `ui/src/app/app.routes.ts` — `settings/connections/:id` children + `settings/rss`.

**Sprint 2**

- **New:** `ui/src/app/providers/openrouter/openrouter-session.ts` (+ spec) — PKCE, key storage,
  `ExpiringConnection`.
- **New:** `ui/src/app/providers/openrouter/openrouter-models.ts` (+ spec) — model list, cached.
- **New:** `ui/src/app/providers/openrouter/openrouter-credits.ts` (+ spec) — the three-state balance.
- **New:** `ui/src/app/pages/openrouter-callback/` — mirrors `pages/dropbox-callback/`.
- **New:** `ui/src/app/pages/settings/connections/openrouter/` — the detail page.
- `ui/src/app/storage-registry.ts` — key + verifier + state + model choice.
- `ui/src/app/app.routes.ts` — `integrations/openrouter/callback`.

**Sprint 3**

- **New:** `ui/src/app/providers/openrouter/prompt-templates.ts` (+ spec) — defaults, overrides, reset.
- **New:** `ui/src/app/providers/openrouter/openrouter-responses.ts` (+ spec) — the inference call.
- **New:** `ui/src/app/providers/openrouter/json-suggestions.ts` (+ spec) — strict parse of the
  model's reply into `string[]`; the single place that distrusts the LLM.

**Sprint 4**

- **New:** `ui/src/app/pages/search/search-helper-dialog/` — the dialog.
- **New:** `ui/src/app/pages/search/search-helper.ts` (+ spec) — propose → grade → refine, pure
  where it can be.
- `ui/src/app/pages/search/search.{ts,html}` — the button.

**Sprint 5**

- **New:** `ui/src/app/compose/tag-helper-dialog/` — the dialog.
- **New:** `ui/src/app/compose/tag-helper.ts` (+ spec) — suggest → activity check → refine.
- `ui/src/app/compose/compose.{ts,html}` — the 🤖#️⃣ button.

## Testing

Specs run only via `npm run test:ci` from `ui/` (raw vitest fails; no targeted runs). Spec
files share a single jsdom realm — see `ui/docs/shared-jsdom-realm-in-tests.md` before
writing anything that touches a global.

The testable core of this effort is deliberately pure: `json-suggestions.ts`, the grading
predicates ("do all five queries clear the threshold?"), and the prompt-template
merge/reset logic. Cover those heavily. The session classes get the `DropboxSession` spec
treatment (stubbed `fetch`, stubbed storage); the dialogs stay thin.

`npm run check:storage` must pass — every new localStorage key needs a
`storage-registry.ts` entry or the build fails.

## The standing constraint

Everything here must work against real mastodon.social with no Mawkingbird server. The
OpenRouter key is the user's, obtained by the user, held in the user's browser, and sent
only to `openrouter.ai`. The credential warning that GitHub and Raindrop already show
applies verbatim and must appear on the OpenRouter page too.
