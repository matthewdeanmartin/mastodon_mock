# The actual last mile

Audit date: 2026-06-20

This is the implementation backlog after comparing the current routers, models,
tests, public documentation, older `spec/*` planning documents, and the reconstructed
Mastodon 4.6.0 OpenAPI schema.

The key finding is that endpoint coverage and fake quality are now different
measurements:

- The OpenAPI operation comparison reports **210 shared operations and 0 truth-only
  operations**. Every path/method in the pinned schema is routed.
- That does **not** mean every operation is a useful fake. Some routes were added only
  to close the operation-count backlog and still return fixed, empty, or no-op
  responses.
- The user-facing Mastodon.py surface is generally stateful and useful. The largest
  remaining user-facing gaps are cross-cutting behavior that CRUD tests do not expose,
  especially filter application, notification policy/requests, and moderation effects.
- Admin CRUD is much better than the older handoff documents say, but admin policy
  effects, trend moderation, and analytics remain shallow.
- Streaming and push are no longer wholly out of scope. SSE and WebSocket streaming
  exist, and push subscription CRUD is persisted. Missing push delivery/crypto remains
  second tier.

## Evidence and limits of this audit

- `uv run mastodon_mock compare-openapi --format text`:
  210 shared, 0 truth-only, 0 required-parameter mismatches.
- The focused OpenAPI, backlog, admin, and streaming tests pass.
- Default Schemathesis fuzzing with one example per shared GET passed its
  no-server-error guarantee.
- Strict Schemathesis remains red. A one-example run stopped after 10 failures,
  including the global FastAPI `{"detail": ...}` error envelope, FastAPI validation
  errors, missing required v1 instance fields, and acceptance of unknown query
  parameters.
- The mock advertises Mastodon 4.4.4 while the reconstructed truth schema is 4.6.0.
  Newer 4.6 routes are present, but version-line compatibility has not been established
  as a coherent contract.
- The generated comparison report calls 13 operations “unexpected” because the CLI's
  coarse prefix ignore-list is separate from the contract test's reviewed per-operation
  `MOCK_ONLY` allow-list. The tests accept those operations, so the report wording is
  misleading.

## Current gap inventory

### Stateful CRUD that is not yet stateful behavior

| Area | What exists | Remaining gap | Priority |
| --- | --- | --- | --- |
| Filters | v1/v2 filter, keyword, and status CRUD is persisted | Filters are not applied to returned statuses. `Status.filtered` is not populated by timeline/context/notification/search reads, and hide/warn/context/expiry behavior is not exercised | High |
| Notification policy | GET returns a fixed accept-all policy; PATCH is ignored | No per-account policy persistence and no request queue. The notification-request family is consequently empty/no-op | High |
| Suggestions | Suggestions are data-derived | Dismissing a suggestion is a no-op, so it immediately reappears | Medium |
| Admin account moderation | Account flags persist | Disabled/suspended/silenced/sensitized state mostly affects admin serialization and filtering, not login, posting, public visibility, media sensitivity, or discovery | High |
| Admin domain/email/IP controls | CRUD persists | Most controls do not affect signup, remote-account visibility, reports, or media. Public instance domain blocks are only a projection of admin rows | Medium |
| Admin trend review | Trend lists are derived | Approve/reject does not persist review state or change public/admin trend results | Medium |
| Quote approval | Approval policy persists and owners can revoke quotes | Quote creation does not enforce the target status's approval policy | High |
| Push subscriptions | One subscription per OAuth token is persisted | Client `p256dh`/auth keys are discarded, `server_key` is fake, and notifications are never delivered or recorded as pushes | Second tier |

### Routed surface that is still shape-only

| Endpoint family | Current behavior | Recommended disposition |
| --- | --- | --- |
| Collections (4.6) | Create returns `{"collection": null}`; reads 404; item operations no-op/empty | Implement only after the higher-value cross-cutting gaps, unless a concrete 4.6 client needs it |
| Annual reports | Empty list/ineligible state; generate/read no-op | Keep a documented deterministic fake, or add a small generated report only if a consumer needs it |
| Async refreshes | Every id is immediately `"finished"` | Acceptable static fake; do not build a job system |
| Account identity proofs | Always empty | Acceptable unless configurable seeded proofs are useful |
| oEmbed | Minimal fixed link response unrelated to a real status | Cheap improvement: resolve a local status URL and emit author/status-derived fields |
| Link timeline/trends | Empty lists despite deterministic per-status preview cards | Derive local URL-bearing statuses/cards; no crawler is needed |
| ToS revision route | Every date returns the current configured ToS | Keep static or support configured revisions; do not invent history |
| Translation | Deterministic Pig Latin | Intentionally fake and useful; leave as-is |
| Email confirmation resend | Successful no-op | Semantically appropriate for this mock |

### Admin-specific gaps

- Account list pagination is applied before the in-Python moderation-status filter.
  A page can therefore be short or omit matching accounts even when later rows match.
- Moderation actions do not retain action history, warning text, or report/action
  linkage beyond marking a supplied report resolved.
- Announcement CRUD persists, but scheduling fields and time-window visibility are not
  modeled.
- Trending tags/statuses are simplistic lifetime counts/favourite ranking rather than
  time-window trends. This is acceptable for a fake, but should be described as such.
- Measures and dimensions return requested keys with zero/empty data. Several useful
  keys can be derived cheaply from existing rows.
- Retention is empty and should remain deliberately shallow unless temporal seed data
  is expanded.

### Contract and shape gaps

- Error responses use FastAPI's `{"detail": ...}` instead of Mastodon's
  `{"error": ...}` shape. This affects many otherwise-correct routes.
- FastAPI's default 422 validation body does not match Mastodon's validation schema.
- Strict fuzzing found missing required v1 instance configuration fields, beginning
  with `configuration.accounts`.
- Many handlers return untyped `dict`/`list`, so the mock's own `/openapi.json` says
  little about response bodies.
- Unknown query parameters are generally accepted even where the reconstructed schema
  disallows them. This is low-value compatibility work and should not outrank stateful
  behavior.
- Strict fuzzing currently covers GET only. Write-path and state-machine conformance are
  not measured.
- The project needs an explicit policy for 4.4 advertised behavior versus 4.6 routed
  behavior: either bump the supported line after validation, or compare against a
  version-matched schema.

### Streaming and security second tier

- SSE and the legacy WebSocket multiplex endpoint are implemented. Older docs claiming
  WebSocket is absent were stale.
- Streaming does not emit `filters_changed`, announcement events, or all Mastodon event
  variants. There is no cross-process bus or replay, by design.
- Push subscription CRUD is implemented; encrypted WebPush delivery and VAPID signing
  are not.
- Scope enforcement is optional and coarse (`read` versus `write`), and admin role
  enforcement is intentionally absent. That is acceptable by default, but an opt-in
  stricter mode would help clients test authorization failures.
- OAuth remains a fake flow. This is a non-goal unless a consumer specifically needs
  browser-grade authorization behavior.

## Phased plan

### Phase 0 — make coverage honest and measurable

Goal: stop treating “route exists” as “stateful fake.”

1. Keep three separate inventories:
   operation coverage, response-shape conformance, and stateful-behavior coverage.
2. Add explicit **Stateful / Derived / Static / No-op / OOS** classifications for every
   routed family added from the OpenAPI backlog.
3. Record strict-fuzz failures by category instead of leaving `QUARANTINE` empty while
   strict mode is broadly red.
4. Make the CLI/report consume the same reviewed mock-only allow-list as the contract
   tests, or rename the report category so reviewed extras are not called unexpected.
5. Decide whether 4.6 is the supported target; align `CURRENT_VERSION`, default
   `mocked_version`, docs, and the truth schema.

Done when the coverage page cannot call operation parity “full coverage” without also
showing behavior quality.

### Phase 1 — close high-value user-facing semantic gaps

Goal: make existing state affect normal reads and writes.

1. Apply persisted filters to statuses and populate `Status.filtered` by context.
2. Enforce quote approval policy during quote creation.
3. Persist dismissed suggestions.
4. Persist notification policy and route disallowed notifications into notification
   requests; implement accept/dismiss/merge state transitions.
5. Add contract tests that prove each write changes a later read.

This is the highest-value phase because it improves the already-strong user-facing fake
instead of adding obscure endpoints.

### Phase 2 — make admin actions have observable consequences

Goal: turn admin CRUD from a control-panel database into moderation behavior.

1. Apply account moderation flags to authentication, posting, serialization, timelines,
   discovery, and forced-sensitive media/status output.
2. Apply signup blocks where the mock has enough input data to do so; document controls
   that cannot be meaningfully enforced without federation or a real network peer.
3. Persist trend approval/rejection and filter trend results accordingly.
4. Fix admin status-filter pagination and round out report validation/action linkage.
5. Add announcement scheduling only if the existing fields are exposed to clients.

Use an opt-in compatibility switch where strict enforcement would break the mock's
current deliberately-permissive testing ergonomics.

### Phase 3 — response-shape conformance

Goal: make the routed surface honestly conform to the pinned schema.

1. Add Mastodon-shaped exception and request-validation handlers.
2. Fill required instance/account/status fields found by strict validation.
3. Add response models or endpoint-to-component mappings for core entities.
4. Run strict GET fuzzing as a ratchet, with reviewed exceptions.
5. Add write-operation and stateful workflow fuzzing after the basic shapes are green.

Do this after Phases 1–2: a perfectly shaped no-op is less useful than a slightly
imperfect stateful fake.

### Phase 4 — cheap derived surfaces and bounded analytics

Goal: replace easy empties without building fake subsystems.

1. Derive link timelines and trends from URL-bearing local statuses and their existing
   deterministic preview cards.
2. Make local oEmbed resolve known local statuses.
3. Implement a documented subset of admin measures and dimensions using database
   counts and date buckets.
4. Keep retention deliberately static unless richer temporal seed data is introduced.

### Phase 5 — selected 4.6 stateful families

Goal: implement newer endpoint families only when they support a real client workflow.

1. Collections are the best candidate: small persisted CRUD plus membership/grant
   transitions.
2. Configurable identity proofs are a cheap optional fixture feature.
3. Annual reports should remain deterministic/generated rather than becoming an
   analytics engine.
4. Async refreshes should remain immediately complete unless background jobs become a
   separate product goal.

### Phase 6 — streaming, push, and security hardening

Goal: improve second-tier systems without blocking the core fake.

1. Add missing stream event families that concrete clients consume.
2. Preserve push encryption inputs and offer a local delivery recorder/callback before
   considering real outbound WebPush.
3. Implement VAPID/encryption only if interoperability tests require ciphertext.
4. Add optional per-endpoint scopes and admin-role enforcement.

## Explicit non-goals

- Federation, ActivityPub delivery, remote WebFinger resolution, and cross-instance
  propagation.
- A realistic ranking engine for trends or recommendations.
- A production security model.
- A realistic retention/analytics warehouse.
- External URL crawling for preview cards.
- Cross-process streaming delivery.

The practical stopping point is after Phase 4 unless a consuming client demonstrates a
need for Phases 5–6.
