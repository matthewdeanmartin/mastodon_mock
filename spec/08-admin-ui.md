# Admin UI / Client (Dogfooding)

> Status: **Phases 1–5 implemented** (Angular 21 SPA served at `/_ui/`, bundled into the
> wheel, CI builds it, smoke-tested). The client covers login (paste-token + dev-login
> helpers), timelines (home/public/local, hashtag, list), compose + reply,
> boost/favourite/bookmark, threads, profiles, follow/unfollow, notifications, search
> (accounts/statuses/hashtags), favourites, bookmarks, and lists — including **editing
> and deleting your own posts** (inline editor + delete, owner-only), **filing
> reports** (from a profile or a status, via a category/comment dialog) and **list
> management** (create/delete lists, add/remove an account to lists from their profile).
> The **admin panel**
> (Phase 4) covers account moderation (silence/suspend/disable + undo, approve),
> the report queue (assign/resolve/reopen), and domain blocks (list/create/delete),
> gated behind a staff role.

### Admin panel (Phase 4)

The admin section lives under `/_ui/admin` and is gated by `adminGuard`, which allows
only accounts whose `verify_credentials` `role` is staff (non-empty role name). To
support that gate, `verify_credentials` now returns the account's `Role` entity in the
`role` field for staff accounts (`null` for ordinary users), matching Mastodon's
`CredentialAccount`. Generate an admin via the login screen's **+ Admin user** button.

Sections (each driving `routers/admin.py`):

- **Accounts** — `GET /api/v2/admin/accounts` filtered by status (active / pending /
  silenced / suspended / disabled); actions via `POST .../action` (silence, suspend,
  disable, sensitive) and the `enable` / `unsilence` / `unsuspend` / `approve` endpoints.
- **Reports** — `GET /api/v1/admin/reports` (open vs. resolved), with `assign_to_self`,
  `resolve`, and `reopen`.
- **Domains** — `GET/POST/DELETE /api/v1/admin/domain_blocks`.

### Dev login (mock-only)

The login screen has a **Dev login** panel that calls two mock-only endpoints so a
tester can get a working session in one click without hand-managing tokens:

- `POST /api/v1/_mock/dev_user` — create a fresh local account (+ token). Body
  `{"admin": bool, "username"?, "display_name"?}`; returns the account plus its
  `access_token`. `admin: true` sets `role: "admin"` (the mock does not enforce roles;
  the admin panel will use it to decide what to surface).
- `GET /api/v1/_mock/dev_users` — list local accounts that have a token (most-recent
  token per account), for the "click to autofill" list.

Both live under the `/api/v1/_mock` prefix (already scope-exempt) and exist only to make
the bundled UI pleasant to drive; they are not part of the emulated Mastodon surface.

## Why

`mastodon_mock` implements a wide slice of the Mastodon REST API but only ever
exercises it through Mastodon.py and pytest. Shipping a browser UI that drives the same
endpoints over HTTP/JavaScript turns the project into its own first client —
**dogfooding** the feature surface. A human (or a screenshot in CI) hitting a broken
timeline or a 422 on "post status" is a coverage signal the contract tests don't give.

The UI is two things in one app:

- a **Mastodon client** — login, timelines, post/reply/boost/favourite/bookmark,
  accounts/follows, notifications, search, lists, filters, polls, conversations, media
  upload; and
- an **admin / moderation panel** — the surface in `routers/admin.py` (accounts,
  reports, moderation actions).

## Decisions

| Concern | Choice |
|---|---|
| Framework | **Angular** (latest), TypeScript, npm |
| Source location | `ui/` at repo root (sibling to `mastodon_mock/`); **not** inside the Python package |
| Built artifacts | `mastodon_mock/_ui_dist/` (git-ignored; produced at build time) |
| Served path | **`/_ui/`** (see "Why /\_ui/" below) |
| Served by | The existing FastAPI app via `StaticFiles(..., html=True)` with SPA fallback |
| Packaging | **Build-on-package**: a hatchling build hook runs `ng build` before the wheel is assembled; artifacts are not committed |
| Auth (v1) | **Paste a seeded `access_token`** (matches how tests authenticate); full OAuth redirect flow is a later phase |

### Why `/_ui/` and not `/`

A real Mastodon instance serves its HTML web application at `/`. `mastodon_mock`
currently serves a JSON identity blob at `GET /`
(`{"mastodon_mock": true, "version": ...}`), and nothing should silently change that
contract. The UI therefore lives at **`/_ui/`**, and `GET /` gains a pointer:

```json
{ "mastodon_mock": true, "version": "4.4.4", "ui": "/_ui/" }
```

## Build & packaging contract (critical)

`pyproject.toml` currently ships only `*.py` + `py.typed` in the wheel:

```toml
[tool.hatch.build.targets.wheel]
packages = ["mastodon_mock"]
include = [
    "mastodon_mock/**/*.py",
    "mastodon_mock/py.typed",
    ...
]
```

For the UI to ship, the wheel must also include the built bundle. Because `_ui_dist/` is
git-ignored, a plain `include` is **not** enough (hatchling skips VCS-ignored files);
the bundle is forced in via `artifacts`:

```toml
[tool.hatch.build.targets.wheel]
artifacts = [
    "mastodon_mock/_ui_dist/**",
]
```

A **hatchling custom build hook** (`hatch_build.py`) runs `npm ci && npm run build`
before the wheel is assembled. `ui/angular.json` sets `baseHref: /_ui/` and
`outputPath: ../mastodon_mock/_ui_dist`; the Angular `@angular/build:application` builder
emits into a `browser/` subdirectory, so the served root is
**`mastodon_mock/_ui_dist/browser/`**. The build environment needs Node; set
`MASTODON_MOCK_SKIP_UI_BUILD=1` to skip (e.g. when the UI was built in a prior CI step).
For local development, a `make ui` target produces the same bundle without packaging.

The server must **boot cleanly when `_ui_dist/` is absent** (e.g. an editable install
that never built the UI): the `/_ui/` mount is conditional, and `GET /` omits the `ui`
pointer in that case, logging a one-line "UI not built — run `make ui`" notice.

## Serving (FastAPI)

`create_app()` calls `mount_ui(app)` (in `mastodon_mock/ui.py`) after the `/media`
mount. `mount_ui` mounts a `StaticFiles(html=True)` subclass at `/_ui` whose
`get_response` falls back to `index.html` on 404, so SPA deep links (e.g.
`/_ui/statuses/123`) survive a refresh; it also registers a `/_ui` → `/_ui/` redirect so
the `base href` resolves. It returns `False` (and logs a hint) when `_ui_dist/browser/`
is absent, in which case `GET /` omits its `ui` pointer and the server boots normally.

## Phases

- **Phase 0 — Spec & scaffolding decisions** (this document).
- **Phase 1 — Skeleton + static serving.** `ng new` in `ui/`; `baseHref: /_ui/`,
  output to `mastodon_mock/_ui_dist/`. Conditional `/_ui/` mount + SPA fallback. Add the
  `"ui"` pointer to `GET /`. Smoke: build, `mastodon_mock serve`, load `/_ui/`.
- **Phase 2 — Packaging.** Extend wheel `include`; add the hatchling build hook and the
  `make ui` target. Verify a clean `pip install` of the built wheel serves `/_ui/`.
- **Phase 3 — Client features.** Login (paste token → `verify_credentials`), timelines
  (home/public/local), post/reply/boost/favourite/bookmark, accounts + follows +
  relationships, notifications, search, lists, filters, polls, conversations, media
  upload. Each screen deliberately exercises a router from `routers/`.
- **Phase 4 — Admin panel.** Wire `routers/admin.py` (accounts, reports, moderation
  actions) into an admin section gated behind an admin-capable token.
- **Phase 5 — CI, tests, docs.** Add a Node build step to the GitHub Actions workflow
  (build UI before packaging; cache npm). A Python smoke test asserting `/_ui/` returns
  HTML and the deep-link fallback works. README + `docs/` section; document `make ui`.

## Open / deferred

- Full OAuth redirect flow in the UI (replaces paste-token login) — Phase 3+ stretch.
- Whether to expose a build-less "served from CDN/devserver" mode for UI development
  (`ng serve` proxying to the running mock) — nice-to-have for Phase 1.
