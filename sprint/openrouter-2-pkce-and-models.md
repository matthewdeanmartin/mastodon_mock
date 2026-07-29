# Sprint 2 — OpenRouter connection: PKCE, model picker, credits

**Goal:** a fifth catalog entry that actually connects. OAuth PKCE against OpenRouter, a
model picker that never renders 500 rows, and a credits readout that tells the truth about
which endpoint answered. No prompts, no helpers, no inference — sprint 3 does that.

Covers overview decisions 1, 2, and the credits/`state` traps documented there.

## Decisions taken (from Matthew, 2026-07-28)

1. **Default model: Gemma.** Specifically `google/gemma-4-31b-it` — verified live against
   `GET /api/v1/models`, 262k context, $0.10/M prompt, $0.34/M completion.
2. **The model list is only ever returned filtered.** "Returning a list of 500 is stupid."
   There is no unfiltered browse mode, not even behind a toggle. See §2.
3. **The OpenRouter key is global to this browser, not scoped to a Mastodon account.**
   Unlike Bluesky — which is a *persona's* account and belongs to whichever Mastodon account
   linked it — an LLM key is the human's, and it works the same whether you are signed in as
   your main, your alt, or Anonymous. This is a deliberate exception to `scopedKey()` and the
   first one in the app; see §5 for the consequences, which are not trivial.
4. **The helper buttons are hidden entirely when OpenRouter isn't connected** (sprints 4/5).
   No upsell, no teaser dialog. "Connections are for power users, and power users will find
   the connection tab."

## Verified against the live API while planning

Worth recording, because two of these change the design:

- `GET /api/v1/models?q=gemma&limit=30` returns `total_count: 9`. The server-side `q` filter
  works and is the whole basis of §2.
- **`google/gemma-4-31b-it` lists `structured_outputs` and `response_format` in
  `supported_parameters`.** This is the big one for sprint 3: we can hand OpenRouter a JSON
  schema and get a shape guarantee rather than parsing prose and hoping. Sprint 3's
  `json-suggestions.ts` becomes a validator of a mostly-trusted payload rather than a
  scraper of an untrusted one — but it still ships, because a provider may ignore the schema.
- **The `:free` variants do not list `structured_outputs`** (only `response_format`). So
  filtering the picker on structured output excludes the free tier. §2 handles this by
  making the filter visible and switchable rather than silent.

## Deliverables

### 1. `OpenRouterSession` — `providers/openrouter/openrouter-session.ts` (new)

Shaped like `DropboxSession`, governed like `GitHubSession`.

```ts
connect(): Promise<void>                       // builds the authorize URL, navigates away
finishAuthorization(params): Promise<void>     // exchanges code -> key
disconnect(): void
readonly connected: Signal<boolean>
enforceLifetime(): void                        // ExpiringConnection
expiresAt(): number | null
```

**Authorization.** `https://openrouter.ai/auth` with `callback_url`, `code_challenge`,
`code_challenge_method=S256`. Reuse `createCodeVerifier` / `codeChallengeFor` from
`src/app/pkce.ts` unchanged.

**The `state` gap (overview §"The `state` gap").** OpenRouter takes no `state` parameter, so
ours rides inside `callback_url`:

```
callback_url = `${location.origin}/integrations/openrouter/callback?state=${state}`
```

OpenRouter appends `code` to that URL, so both survive the round trip.
`finishAuthorization` verifies with `statesMatch()` exactly as Dropbox does, and **fails
closed** — a missing or mismatched `state` is an error, never a shrug. If OpenRouter ever
starts stripping unknown query params, every connection attempt fails loudly, which is the
correct direction.

**Exchange.** `POST https://openrouter.ai/api/v1/auth/keys`, JSON body
`{ code, code_verifier, code_challenge_method: 'S256' }`, response `{ key, user_id }`.
The verifier and state live in `sessionStorage` and are cleared in a `finally`, as Dropbox
does.

**Storage.** `localStorage`, `stampCredential`-ed, **unscoped** (§5). The key is `secret`.

### 2. `OpenRouterModels` — `providers/openrouter/openrouter-models.ts` (new)

The rule: **this service has no method that returns all models.** The only public call takes
a query and passes it to the server.

```ts
search(query: string, opts?: { structuredOnly?: boolean }): Promise<OpenRouterModel[]>
```

- Hits `GET /api/v1/models?q=<query>&limit=20`, plus
  `&supported_parameters=structured_outputs` when `structuredOnly` (the default).
- Returns a trimmed model shape — `id`, `name`, `context_length`, `pricing.prompt`,
  `pricing.completion`. Not the full object; the response carries benchmarks, design-arena
  ELO, and a dozen other fields the picker will never show, and holding them in memory is
  just a bigger surface to typo against.
- Public endpoint, no auth needed — so the picker works *before* connecting, which is worth
  something: you can see what you'd be picking from.
- Caches per `query + structuredOnly` for the page session. No persistent cache: model
  pricing changes and a stale price shown next to a spend decision is worse than a request.

**UI (on the OpenRouter page).** A search box, a result list, and a chosen-model row. Empty
query shows the current default (`google/gemma-4-31b-it`) and nothing else — not a "top 20",
because a top-20 is a list of 500 with a `.slice()` and invites exactly the browsing this
decision rejects. A "only models that support structured output" checkbox, on by default,
with one line saying why (both helpers ask for JSON) and noting that unchecking it surfaces
the free variants.

The chosen model id persists to `localStorage`, unscoped, sensitivity `setting`.

### 3. `OpenRouterCredits` — `providers/openrouter/openrouter-credits.ts` (new)

The three-state readout from the overview. One method, one discriminated union:

```ts
type CreditsState =
  | { kind: 'capped';    remaining: number; limit: number }   // GET /api/v1/key, limit != null
  | { kind: 'uncapped';  used: number }                        // GET /api/v1/key, limit == null
  | { kind: 'account';   remaining: number; total: number }    // GET /api/v1/credits (management key)
  | { kind: 'unknown';   reason: string };
```

Order of operations: call `GET /api/v1/key` first (it is the one a PKCE key can always use).
Then *opportunistically* try `GET /api/v1/credits`; **a 403 there is not an error** — it
means "this is an inference key", which is the normal case — and must never reach the UI as
a red message. Only a successful `/credits` upgrades the display to `account`.

This is the single most likely thing to be got wrong by someone reading only the doc page
Matthew linked, so the 403-is-normal branch gets an explicit unit test.

### 4. Callback page + route

`pages/openrouter-callback/` mirroring `pages/dropbox-callback/` — same card, same
`aria-live`, navigates to `/settings/connections/openrouter` with `?openrouter=connected` or
`?openrouter=error&message=…`. Route `integrations/openrouter/callback`, registered next to
the Dropbox one.

### 5. Unscoped storage — the consequences

This is the sprint's real risk, and it is not in the OAuth code.

`scopedKey()` exists because "seeing another account's feeds is confusing and wrong". We are
deliberately opting out for one key. Three things follow, and all three need handling:

1. **`storage-registry.ts`** — register with `scoped: false`, sensitivity `secret`.
   `npm run check:storage` fails the build otherwise. The registry entry's comment must say
   *why* it is unscoped, since every neighbour is scoped.
2. **Settings → Signed-in accounts** deletes one account's local data by scope suffix.
   An unscoped key has no suffix, so it is *already* untouched by that path — which is the
   behavior we want (removing your alt must not log you out of OpenRouter), but it is
   accidental rather than intended. Add a spec that pins it.
3. **The retention policy is account-scoped; this credential is not.** So "disconnect after
   30 days" set while signed in as your main governs a key your alt also uses, and
   enforcement runs under whichever account is active. **Decision: the active account's
   policy governs, and the page says so in one line.** The alternative — shortest-policy-wins
   across accounts — requires reading every account's policy on every load to protect a key
   the user can revoke at OpenRouter in two clicks. Not worth it. Flag if you disagree.

### 6. Catalog entry + page

Fifth entry in `CONNECTION_CATALOG`, and the first one whose `enables` describes features
that don't exist yet — so word them as what they *will* turn on, and don't ship the entry
until sprint 3 makes at least one true. Suggested:

| id | emoji | pitch | enables |
|---|---|---|---|
| `openrouter` | 🧠 | One key, hundreds of AI models, billed by usage. | Turn plain English into Mastodon search queries · Suggest hashtags that actually have activity |

The page (`connections/openrouter/`) holds: connect/disconnect, the credits readout, the
model picker, and the standard credential warning — the key is sent only to `openrouter.ai`,
never to Mockingbird.

### 7. Specs

Pure/near-pure and worth heavy cover:

- **`state` verification**: missing, mismatched, and correct — all three, with mismatch
  asserting no key is stored.
- **The 403-on-`/credits` path** producing `capped`/`uncapped`, never an error.
- **`limit: null`** producing `uncapped`, not `remaining: NaN` or `$0.00 remaining`.
- **`OpenRouterModels.search` always sends a filter** — a spec that fails if any request URL
  lacks `q` or a filter param. This is decision 2 as an executable rule rather than a habit.
- **Unscoped storage**: the key survives `scopedKey`-based per-account deletion.

Session specs follow the `DropboxSession` pattern (stubbed `fetch`, stubbed storage).
Remember the shared jsdom realm (`ui/docs/shared-jsdom-realm-in-tests.md`).

## Acceptance

- `npm run test:ci`, `lint`, `format:check`, `check:storage`, `build` all pass.
- A real PKCE round trip against openrouter.ai completes and stores a key.
- Tampering with `state` in the callback URL fails closed and stores nothing.
- The model search never issues an unfiltered request (assert in a spec, not by eye).
- Credits render sensibly for a key with a cap, a key without one, and a failed lookup.
- Removing another signed-in account leaves the OpenRouter connection intact.

## Deviations from the plan as written

- **`OpenRouterModelChoice` is its own service**, not a field on the models service. The
  chosen model is a *setting* that outlives any search and is read by the helpers in sprints
  4/5; the search service is a stateless cache in front of a public endpoint. Merging them
  would make every helper import the search machinery to read one string.
- **`stubLocation` gained an `onAssign` option.** The session navigates with
  `location.assign` (as `DropboxSession` does), and the existing helper hard-coded that to a
  no-op, so the authorize URL was unobservable. Chromium also refuses to let `location.assign`
  be overwritten at all, so the browser-level check fulfils the request at the network layer
  instead — noted here because the next connector with an OAuth redirect will hit both.
- **Credits treats 401 as "revoked", not just "unknown"**, and disconnects. Not in the plan,
  but a key OpenRouter no longer recognises is not a connection, and leaving the page claiming
  "Connected" while every call fails is the worse lie.
- **The model picker renders before you connect.** Planned, but worth restating: the models
  endpoint needs no auth, so the page shows the default model and its live pricing to someone
  who has not authorized anything. It is the honest way to answer "what am I signing up for?".

## Verified at runtime

Driven in a real browser against the live API (24 checks, all passing):

- Catalog entry present, badged **All accounts**, pitching both helpers.
- Model search hits `/api/v1/models` three times across the session; **every** request carried
  `q=`, `limit=20` and `supported_parameters=structured_outputs`. The no-unfiltered-request
  rule holds in practice, not just in the unit spec.
- Live pricing renders: `262,144 token context · in $0.10 / M tokens · out $0.34 / M tokens`.
- Choosing a model persists it to an **unscoped** key, survives reload, and resets cleanly.
- Clicking Connect produces a real authorize URL with `code_challenge_method=S256`, a
  challenge, and a `callback_url` carrying our `state` — with no verifier anywhere in it.
- A tampered `state` on the callback stores no key, shows the error, clears the pending flow,
  and leaves the page reading "not connected".

## Explicitly deferred

- Prompt templates, the responses call, and any inference — sprint 3.
- Pasting a management key to get account-wide credits. The `account` branch exists so the
  display doesn't have to change later; nothing produces it yet.
- Per-model cost estimation ("this search will cost ~$0.0002"). Wants real token counts.
- Streaming, tool calls, multi-modal input.
