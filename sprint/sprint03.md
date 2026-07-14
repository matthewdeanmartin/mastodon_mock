# Sprint 03 — 2018-Twitter-style Settings Page

## Goal
Replace the cramped 4-tab `/settings` page with a full-width, 2018-Twitter-style
settings area: boxed left sidebar of categories, wide content pane, top bar kept,
left/right rails dropped on settings routes. Categories mirror mastodon.social's
grouping. Admin screens (`/admin`) are NOT touched.

## Decisions (user-confirmed)
- **Backend endpoints get added** for categories the mock lacks (not stubs).
  Non-standard endpoints go under `/api/v1/_mock/...` (allow-listed in
  `openapi_compare.py` DEFAULT_MOCK_ONLY_PREFIXES — no drift).
- **Muted words = full Mastodon v2 filter editor** (title, contexts, expiry,
  warn/hide, keywords) backed by existing `/api/v2/filters` API (already complete
  in `mastodon_mock/routers/filters.py`).
- **Layout**: keep top bar, drop rails, full width below.
- **Mutes/Blocks** become their own sidebar items; Follow requests goes under
  "Follows and followers".

## Sidebar categories (planned)
Public profile · Privacy and reach · Preferences (appearance / posting defaults /
email notifications) · Follows and followers · Muted accounts · Blocked accounts ·
Filters · Automatic post deletion · Account · Import and export · Invite people ·
Development

## Key facts discovered
- Settings UI: `ui/src/app/pages/settings/` (single component, 4 tabs). Routes in
  `ui/src/app/app.routes.ts` (settings is a child of Shell).
- Shell layout: `ui/src/app/shell/shell.css` `.layout` grid `290px | col | 320px`.
  Plan: add a class when URL starts with `/settings` → `grid-template-columns: 1fr`,
  hide rails.
- `update_credentials` already supports `source[privacy]`, `source[sensitive]`,
  `source[language]` (accounts.py ~497) → posting defaults are real already.
- `/api/v1/preferences` read-only exists (`routers/preferences.py`).
- v2 + v1 filters API fully implemented server-side; UI has no api.ts methods yet.
- Invites / post-deletion / import-export / apps-list / email-notif prefs do NOT
  exist in real Mastodon API (checked mastodon-openapi/dist/schema.json) → _mock ns.
- Existing _mock endpoints live in `routers/oauth.py` (login, dev_user, reset,
  sample_data, faults).
- DB: `mastodon_mock/db/models.py`, alembic migrations in `mastodon_mock/alembic/versions/`.
- Project rules: uv only (`uv run make check`), mypy strict, 120-char lines,
  Google docstrings, tests in `tests/`.

## Task board
1. [x] Backend: _mock endpoints — DONE. Files:
       - `mastodon_mock/db/models.py`: new `AccountSettings` (JSON blob incl.
         appearance/email_notifications/post_deletion) + `Invite` models.
       - `mastodon_mock/alembic/versions/e7a91c5b3d42_add_account_settings_and_invites.py`
         (head after d3f4a6b8c201).
       - `mastodon_mock/routers/user_settings.py`: GET/PUT `/api/v1/_mock/settings`
         (deep-merge over DEFAULT_SETTINGS), invites CRUD (`/api/v1/_mock/invites`),
         `/api/v1/_mock/apps` (authorized apps via token join),
         `/api/v1/_mock/export/{following|mutes|blocks}` CSV,
         POST `/api/v1/_mock/import` {type, csv}.
       - Registered in `app.py` (import list, include loop, OPENAPI_TAGS "mock settings").
       - Tests: `tests/mock_only/test_user_settings.py` — 16 pass incl. alembic-drift
         + openapi-contract gates. Ruff+mypy clean.
2. [x] UI core — DONE:
       - `ui/src/app/models.ts`: ContentFilter/FilterKeyword/Preferences/MockSettings/
         Invite/AuthorizedApp/ImportReport types; Account.discoverable added.
       - `ui/src/app/api.ts`: preferences(), filters CRUD + keyword add/delete,
         mockSettings()/updateMockSettings(), invites CRUD, authorizedApps(),
         exportCsv()/importCsv().
       - `ui/src/app/shell/*`: `wide` signal (router URL starts with /settings) →
         `.layout-wide` drops both rails, full-width column. Admin untouched.
       - `ui/src/app/pages/settings/settings-shell.*`: sidebar (profile card +
         14 categories, chevrons, active = accent bg). Mock-only pages
         (appearance, notifications, deletion, import-export, invites, development)
         are hidden when `environment.mockTooling` is false (Mocking Bird flavor).
       - `app.routes.ts`: /settings parent + 16 child routes (redirect → profile).
       - Shared form styles appended to `ui/src/styles.css` (.spage-head, .spage-body,
         .ssection, .srow/.slabel/.scontrol, .sactions, .checkline/.radioline, .hint).
       - Old pages/settings/settings.{ts,html,css,spec.ts} DELETED.
       - Pages written by me: profile/, account-list/ (mutes+blocks via route data
         kind), follows/ (requests), all with specs.
3. [x] Filter editor — DONE: filters/settings-filters.* (list, delete, summaries) and
       filters/settings-filter-edit.* (new+edit; title/contexts/warn-hide/expiry;
       keywords added/removed via sub-API on existing filters, keywords_attributes
       on create). Specs cover create/validation/edit+keyword-sync.
4. [~] Leaf pages (privacy, appearance, posting, notifications, deletion, account,
       import-export, invites, development) delegated to a subagent — files all
       exist; awaiting its verification report. Review before trusting.
5. [ ] Quality gates: `uv run make check`; ui build + vitest + eslint (pending
       subagent completion).

## Status
- Sprint started 2026-07-13. ALL FEATURE WORK DONE:
  backend `_mock` endpoints + migration + tests; settings shell + 14 pages
  (subagent-built leaf pages reviewed, all good); filter editor; full-width
  layout. Verified: both Angular builds (default + mockingbird) compile; all
  15 settings spec files pass (33 tests); UI lint + prettier clean.
- `uv run make check` PASSED end to end (exit 0, 2026-07-13): format, lint,
  security, pytest, typecheck ×3, UI lint/tests/builds, npm audit clean.
  Sprint complete; nothing is committed yet — review the working tree and commit.
- User Q&A: `_mock` endpoints intentionally never work against real Mastodon
  (no upstream API exists for those pages); standard-API pages do. Mock-only
  settings pages hidden in Mocking Bird build via environment.mockTooling.

## Pre-existing issues found (NOT from this sprint; fixed or noted)
- Fixed to unblock the gate: isort violation in routers/statuses.py; yamlfix on
  .github/workflows/release.yml; 11 UI eslint errors (unused `Signal` imports in
  announcements/compose/explore/tag specs, Array<T> in compose.spec, empty
  fakeEvent fns in lists.spec, a11y on profile.html block-confirm overlay).
- Pre-existing vitest failures (~28 tests, failed at clean HEAD too) — ALL FIXED:
  - Cross-file leakage: specs share a jsdom realm, so localStorage written by one
    file (shell.spec's saved mastodon.art session) poisoned later files. Fixed with
    `ui/src/test-setup.ts` (clears storage before every test) wired via
    angular.json test options `setupFiles`.
  - tag/thread/list-timeline specs: `TestBed.inject(HttpTestingController)` in
    beforeEach instantiated the module, so the later per-test
    `TestBed.overrideProvider(ActivatedRoute, ...)` threw. Moved the inject to
    after the override inside the setUp helpers.
  - shell.spec: didn't account for right-rail trends/instance requests; drained
    via httpMock.match().
  - admin.guard.spec: awaited the guard's cold Observable without subscribing
    (no request ever fired); wrapped in firstValueFrom().
  Full UI suite now green: 46 files / 339 tests.

## Handoff notes
- If `uv run <script>` fails with "uv trampoline failed to canonicalize script
  path": delete `.venv` and `uv sync --all-extras` (fixed it on 2026-07-13).
- Auth in raw-http tests: token for alice fixture is `alice_token`; permissive
  authorization-code flow accepts `code=mockcode_<username>`.
- Settings UX notes: keywords on an existing filter are immutable rows
  (delete + re-add to change) — matches the v2 keywords sub-API; expiry on
  edit is "keep current" unless a new duration is picked (API has no way to
  read back remaining seconds).
