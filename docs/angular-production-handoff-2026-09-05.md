# Angular production review handoff — 2026-09-05

## Scope and current work

This is a targeted source review of `ui/src/app`, including the Angular clients for the Cloudflare services. It is not a complete security audit, dependency audit, browser performance profile, or review of the Workers. The Python mock server was outside scope. Findings below follow production source paths; existing specs were not treated as proof of correctness.

The accompanying changes address three requested findings:

- **Bluesky audience:** the composer requires public visibility for Bluesky and Both. Restricted drafts retain their audience when destinations change, show an explanation, and cannot submit. The check also runs at actual send time after the undo-send countdown.
- **Credential propagation:** automatic Mastodon Authorization is limited to the selected instance's origin and API path. Static assets, lookalike hosts, different schemes/ports, and other destinations do not receive it. Explicit caller credentials and external/search exclusions remain supported. Translation requests also explicitly opt out.
- **Draft ownership:** named drafts, autosaves, and in-memory handoffs are scoped by server and the existing account scope. Writing surfaces capture an owned store so late writes cannot switch owners; root readers follow account changes, including sign-in without a reload. Anonymous draft backup/deletion follows the same ownership rules. No draft migration or recovery UI is required: the owner confirmed there is no existing draft data to migrate.

These changes do not resolve the global token-derived identity issue below, and are not a general redesign of live session transitions.

## Remaining findings, in priority order

### P1 — Settings sync applies stale assumptions about local edits

**Source:** `ui/src/app/providers/account/profile-sync.ts`, `pull`, `applyFetched`, and `push`.

`pull` reads the local record before awaiting `fetchSettings`, then uses that captured `dirty` value to decide whether to silently apply remote settings. An edit made while the request is in flight can therefore be overwritten. A successful `push` similarly clears `dirty` after saving an older snapshot, even if another edit has happened since.

**Fix direction:** maintain a monotonically increasing local edit generation. Serialize sync operations. Clear dirty state only for the generation actually persisted, and check current state immediately before applying a remote document. Handle sign-out/account changes while requests are outstanding too.

**Acceptance:** hold a GET response, edit locally, then release it: the edit survives and a conflict decision is required. Hold a PUT response, edit again, then release it: the later edit remains pending until its own write succeeds. Exercise overlapping pull/push and sign-out.

### P1 — A conflict ETag is adopted before conflict resolution

**Source:** `profile-sync.ts`, the `result.kind === 'conflict'` branch of `push`.

The handler adopts the remote ETag/revision and leaves local data dirty. A later local edit schedules another push using that adopted ETag, which can overwrite the remote changes without a decision. A subsequent conditional pull can also return unchanged because it uses the conflicting remote ETag, preventing the promised conflict presentation.

**Fix direction:** retain an explicit unresolved conflict containing the competing documents and their versions. Stop automatic writes until the user chooses or a merge succeeds. Distinguish “observed remote version” from “version our local document incorporates.”

**Acceptance:** browser A saves a change; browser B conflicts, then makes another edit. B must neither overwrite A nor lose the conflict prompt. Test both keep-local and keep-remote paths.

### P2 — Account storage identity changes when credentials change

**Source:** `ui/src/app/account-scope.ts`, `scopeSuffixForToken` and `hash`; consumers use `scopedKey` or the same suffix.

Mastodon scopes derive from a 32-bit hash of the access token. Reauthorizing the same account with a different token selects a different namespace. Existing feeds, settings, connectors, and now scoped drafts can appear absent. Hash collisions are also possible; this hash must not be considered an isolation guarantee against deliberately selected inputs.

**Fix direction:** use a stable provider + server + verified account identity, keeping credentials separate. Plan this across consumers and account deletion/export together. The owner explicitly does not need draft migration today; do not build speculative draft migration machinery.

**Acceptance:** reauthorize with a different token and retain the same data; two accounts with the same numeric ID on different servers remain separate; test Bluesky and anonymous identities too.

### P2 — Draft persistence failure is reported as success

**Source:** `ui/src/app/drafts.ts`, `storeJson`; `ui/src/app/compose/compose.ts`, `saveDraft`.

Storage exceptions are swallowed. The composer then resets and displays saved status, although the only remaining copy may be in memory. Reloading loses it. Draft scoping does not fix this behavior.

**Fix direction:** return an explicit persistence outcome. Preserve editor text on failure, explain that it is unsaved, and offer a local download. Consider autosave failure and multiple tabs overwriting the same stored list.

**Acceptance:** make `localStorage.setItem` throw a quota error. Neither explicit save nor autosave may report durable success or discard the only copy. Test a second tab editing the same draft/list.

### P2 — Publishing races media-description updates

**Source:** `ui/src/app/compose/compose.ts`, `send`.

Media description updates start with independent subscriptions, and status creation starts immediately afterward. Slow or failed updates can leave the published attachment without the entered alt text.

**Fix direction:** await all required media metadata updates before creating the post. Keep a recoverable editor state on failure. Audit scheduled and cross-posted media behavior at the same time.

**Acceptance:** delay or reject a media update. No Mastodon status is created before required metadata succeeds; a retry preserves the text, attachment, and description.

### P2 — Live timeline insertion bypasses bounds and deduplication

**Source:** `ui/src/app/pages/home/home.ts`, `syncLive` versus `mergeStatuses`.

Streaming updates prepend directly to the list; pagination uses a bounded merge. An active timeline can grow indefinitely despite `feedMax`, and duplicate streaming updates can produce repeated IDs.

**Fix direction:** one insertion policy for streaming, paging, and locally created posts. Preserve reading position when trimming. Measure long-running heap and rendering behavior before deciding whether virtualization is necessary.

**Acceptance:** inject many more updates than the cap, including duplicates. Stored/rendered rows remain bounded, IDs remain unique, and reading position remains usable. This review did not measure current frame time or memory usage.

### P2 — Ambiguous-success posting retries can duplicate posts

**Source:** `ui/src/app/api.ts`, `postStatus`; `compose.ts`, `postRest`, `postBskyPart`, and the parallel Both path.

Mastodon status creation sends no idempotency key. A committed post with a lost response appears failed; retrying can duplicate it. Thread and multi-destination operations also need independent completion tracking rather than retrying the whole composition.

**Fix direction:** assign an operation identity, retain per-segment/per-destination results, and reuse the same idempotency key for a retry of unchanged content. Do not reuse it for a newly edited post. Mastodon documents `Idempotency-Key` at https://docs.joinmastodon.org/methods/statuses/.

**Acceptance:** simulate a committed write with a lost response, a failure halfway through a thread, and each ordering of success/failure across Fedi and Bluesky. Retry must not duplicate completed work or falsely claim success on the other destination.

## Maintenance and next review

Prioritize shared rules for identity, audience, persistence, and asynchronous work over a rewrite. The composer coordinates many destinations with different capabilities; represent those capabilities explicitly so new providers cannot silently inherit unsupported privacy or scheduling options.

Some Plus UI errors expose terms such as “profile Worker,” “vault binding,” and “unexpected on test” in the English dictionary (`plus.vault.error.*`). Replace them at their source i18n comments with actionable user messages and support references; regenerate the dictionary. Extensive historical comments are maintenance noise, but are not themselves evidence of a security defect.

The Cloudflare review still needs to cover server-side authorization and cross-account access, billing webhook authentication/idempotency/order, entitlement consistency and cancellation, proxy abuse/SSRF and cost controls, and profile storage isolation. The Angular fixes do not establish those guarantees.

Also inspect credential ownership across queued requests and account switches: the current interceptor chain performs rate-limit waiting before automatic token attachment, while account switching activates the new account before verification/reload. Destination checks alone do not prove that a delayed operation retains its initiating identity.

## Validation

- Focused regression suite: **174 passed** across auth interception, composing, drafts, and session teardown.
- Required `make test`: **6,015 passed, zero failed, zero pending**; source integrity and runtime manifest checks passed. No tests were skipped or weakened.
- Full `npm run lint`, storage registry check, i18n check, changed-source formatting, and `git diff --check`: passed.
- `npm run build:mockingbird`: passed, including the post-build mock-server leakage check. The build reports CommonJS optimization warnings (including `@mozilla/readability`); these are not resolved by this change.
- No deployment, real posting, or browser interaction test was performed. Browser privacy/audience behavior is covered by Angular component and HTTP regression tests; the remaining acceptance scenarios above are future work.

Local ignored logs: `ui/.test-results/review-full-gate.log`, `review-focused.log`, `review-lint.log`, `review-i18n.log`, and `review-build.log`.
