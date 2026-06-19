# Fix: Missing UI Features — Phased Implementation Plan

Companion to [`missing_ui.md`](./missing_ui.md), which catalogs the gaps between the
`mastodon-mock` backend and the Angular test/admin harness in `ui/`. This document
turns that catalog into an ordered, shippable plan.

## Goals & non-goals

- **Goal:** let a human exercise *every* client-to-server (C2S) backend feature from
  the browser, without first writing a Mastodon app — the UI is a test harness /
  admin panel for the mock server.
- **Non-goal:** ActivityPub / server-to-server federation. The mock is C2S only;
  nothing here implements or assumes federation.
- **Backend is already done.** Every route referenced below exists in
  `mastodon_mock/routers/` and was hardened against real desktop clients +
  4 Python apps. This plan is **UI-only** — if a UI need exposes a genuine backend
  gap, that is a separate ticket, not part of these phases.

## Conventions (match the existing `ui/` codebase)

- Angular 21, standalone components, **signals** (`signal`/`computed`/`input`/`output`),
  `inject()`. No NgModules.
- All HTTP goes through `ui/src/app/api.ts` (public API) and
  `ui/src/app/admin/admin-api.ts` (admin API). Add typed methods there; components
  never call `HttpClient` directly.
- Response/request shapes are interfaces in `ui/src/app/models.ts`.
- Form-encoded vs JSON: mirror the backend. The backend's `_form_or_json` accepts
  both, but array params use the `key[]` convention (see `media_ids[]`, `choices[]`,
  `poll[options][]`) — replicate exactly how the existing `relationships()` /
  list-accounts methods build `HttpParams`.
- **Definition of Done per phase:** `cd ui && npm run build` is clean, the feature is
  reachable from the nav/relevant card, and it round-trips against a running mock
  (`mastodon-mock` serve + dev login). No eslint config exists; build is the gate.
- Keep components small and co-located (`feature/feature.ts|html|css`), matching
  `pages/` and the dialog components (`report-dialog`, `list-dialog`).

---

## Phase 1 — Status & Composer (spec §1) ✅ *this session*

Highest exercise-value: these touch the two most-used components (`compose`,
`status-card`) and unlock the core write/read surface.

### 1a. Composer upgrades (`ui/src/app/compose/`)
- **Visibility selector** — dropdown (`public` / `unlisted` / `private` / `direct`),
  passed as `visibility` to `POST /api/v1/statuses`. Default `public`.
- **CW / spoiler + sensitive toggle** — optional `spoiler_text` field and `sensitive`
  flag (small win, same write path; the edit path already supports `spoiler_text`).
- **Attach media** — file picker → `POST /api/v2/media` (multipart: `file`, optional
  `description`), collect returned `id`s, send as `media_ids[]` on post. Show
  thumbnails + a per-attachment description (alt-text) field; allow remove-before-post.
- **Poll builder** — toggle to add 2–4 options, `multiple` checkbox, `expires_in`
  select (5m/1h/1d/…). Send as `poll[options][]`, `poll[expires_in]`, `poll[multiple]`.
  Mutually exclusive with media in the UI (matches Mastodon).

`api.ts` additions: extend `postStatus(...)` to accept an options object
(`{ inReplyToId?, visibility?, spoilerText?, sensitive?, mediaIds?, poll? }`) rather
than adding positional params; add `uploadMedia(file, description?)` and
`updateMedia(id, description)`.

### 1b. Status-card upgrades (`ui/src/app/status-card/`)
- **Translate** — button → `POST /api/v1/statuses/{id}/translate`; show returned
  (pig-latin) `content` inline with a "Show original" toggle. No model change to the
  stored status; hold the translation in a local signal.
- **Poll rendering + voting** — render `status.poll` options with vote bars; if not
  yet `voted` and not `expired`, allow selecting option(s) and
  `POST /api/v1/polls/{id}/votes` with `choices[]` (option positions). Refresh from
  the returned poll. Respect `multiple` (checkboxes vs radios) and `hide_totals`.
- **Pin / Unpin** — owner-only action → `pin`/`unpin`; reflect `status.pinned`.
- **Mute / Unmute thread** — `mute`/`unmute`; reflect `status.muted`.
- **Edit history** — "Edited" affordance opens a dialog listing
  `GET /api/v1/statuses/{id}/history` snapshots (content + timestamp).
- **Interaction policy + quote revoke** — owner-only menu to set
  `quote_approval_policy` (`public`/`followers`/`nobody`) via
  `PUT .../interaction_policy`; on a status that quotes one of yours, a "revoke quote"
  action via `POST .../quotes/{quoting_id}/revoke`.
- **Favourited-by / Reblogged-by** — make the favourite/boost counts clickable to open
  a reusable account-list dialog backed by `GET .../favourited_by` /
  `GET .../reblogged_by`. (Reuse/generalize the existing `list-dialog` pattern.)

### Phase 1 model additions (`models.ts`)
- `Poll` + `PollOption` interfaces; add `poll: Poll | null` and `pinned`, `muted`,
  `quote_approval_policy` to `Status` (verify against `serializers/statuses.py` —
  several already serialized).
- `StatusEdit` interface for history entries.

---

## Phase 2 — Direct Messages & Conversations (spec §2)

- New nav entry + lazy route `/conversations` → `pages/conversations/`.
- `api.ts`: `conversations()` (`GET /api/v1/conversations`),
  `markConversationRead(id)` (`POST .../{id}/read`); confirm shapes against
  `routers/conversations.py`.
- List conversations grouped by participant, last message preview, unread badge,
  "mark read" button.
- Open a conversation → thread view reusing `status-card`; reply via `compose`
  pre-seeded with `visibility=direct` and the participant `@mention`(s).
- `Conversation` model interface in `models.ts`.

## Phase 3 — Account Customization & Settings (spec §3)

- New lazy route `/settings` → `pages/settings/` with sub-sections.
- **Profile editor** — `PATCH /api/v1/accounts/update_credentials` (multipart for
  `avatar`/`header`): display name, note/bio, `locked`, `bot`, and the key/value
  **metadata fields** (`fields_attributes[n][name|value]`).
- **Mutes / Blocks** — list via `GET /api/v1/mutes` / `/blocks`, with unmute/unblock
  actions (relationship endpoints already partly wired).
- **Follow requests** — `GET /api/v1/follow_requests` + authorize/reject for locked
  accounts.
- **Followed hashtags + tag actions** — on `/tags/:tag`, follow/unfollow
  (`POST /api/v1/tags/{tag}/follow|unfollow`) and feature/unfeature; a
  "Followed tags" list page (`GET /api/v1/followed_tags`).
- `api.ts` additions for each; new model interfaces (`FollowRequest`, `FollowedTag`,
  `CredentialFields`).

## Root content negotiation (done 2026-06-19, alongside Phase 4)

`GET /` now content-negotiates (in `mastodon_mock/app.py`): browsers (`Accept: text/html`)
are 307-redirected into the SPA at `/_ui/`; API clients (`*/*`, `application/json`, or
no Accept) still get the JSON identity doc. This means a browser hard-refresh on `/`
lands back in the app instead of raw JSON. The SPA-fallback for deep links already
existed in `mastodon_mock/ui.py` (`_SpaStaticFiles`), scoped to `/_ui/`. Tests in
`tests/test_ui.py`.

## Phase 4 — Moderation & Admin (spec §4) ✅

Extend `ui/src/app/admin/` (admin-api + existing admin sub-pages).
- **Account actions** — wire reject (`POST .../admin/accounts/{id}/reject`), delete
  (`DELETE .../admin/accounts/{id}`), unsensitive (`POST .../unsensitive`) into
  `admin/accounts`.
- **Domain allows** — new admin sub-page (`/api/v1/admin/domain_allows`), sibling to
  the existing `domains` (blocks) page.
- **Email + canonical email blocks** — list/add, plus the canonicalization "test"
  match tool.
- **IP blocks** — list/create/update/delete (`/api/v1/admin/ip_blocks`).
- **Trend moderation** — approve/reject buttons on `admin/trends`.
- **Metrics** — read-only panel for `admin/measures`, `admin/dimensions`,
  `admin/retention`.

## Phase 5 — System & Infrastructure (spec §5)

- **SSE streaming** — an `EventSource`-based service consuming `/api/v1/streaming`
  (`stream_user`, `stream_public`, etc.); opt-in "live" toggle on timelines /
  notifications that prepends incoming events. Carries the access token (query param,
  since `EventSource` can't set headers — confirm `streaming.py`'s auth scheme).
- **Full OAuth flow** — optional alternative to dev-login on the login page: register
  app (`POST /api/v1/apps`), redirect through `/oauth/authorize`, exchange code at
  `/oauth/token`. Keep dev-login as the default fast path.
- **Fault-injection control plane** — a developer-settings page driving
  `/api/v1/_mock/faults` (rate-limit / latency / timeout / malformed-JSON rules):
  view current rules, add/update, clear. This is the marquee test-harness feature.

---

## Sequencing rationale

Phases are ordered by **exercise-value per unit of work**: Phase 1 lights up the
components every tester touches first and is mostly additive to two files. DMs (2) and
settings (3) are self-contained new routes. Admin (4) extends an existing, already-
structured area. Infra (5) is last because SSE/OAuth/faults are the most cross-cutting
and benefit from the rest of the UI existing to observe their effects.

Each phase ends in a clean `npm run build` and a manual round-trip against a running
mock, and can ship independently.
