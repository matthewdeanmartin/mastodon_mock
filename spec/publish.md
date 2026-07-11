# Publishing roadmap — "Mocking Bird" client, Docker, and registries

This document plans three publishing tracks that all build on artifacts the project
*already* produces. None of them require a new application; they repackage the existing
Angular UI (`ui/`, built into `mastodon_mock/_ui_dist/browser`) and the existing
FastAPI server (`mastodon_mock`).

The three tracks are independent and can ship in any order:

1. **Mocking Bird** — publish the test UI as a standalone, static-only Mastodon web
   client with all mock-server affordances removed.
2. **One-click deploy** — publish a Dockerfile + platform manifests so the *mock server*
   (UI included) runs on Render, PythonAnywhere, Koyeb, and Railway.
3. **GitHub Container Registry** — publish the Docker image to `ghcr.io` on release.

---

## Current state (what we build on)

- The UI is an Angular 21 SPA in `ui/`, built by `make ui` into
  `mastodon_mock/_ui_dist/browser` (`angular.json` → `outputPath`, `baseHref: "/_ui/"`).
- It is served same-origin under `/_ui/` by `mastodon_mock/ui.py` (`_SpaStaticFiles`
  with SPA `index.html` fallback). When the bundle is absent the mount is skipped.
- The UI already has a clean seam for "which server am I talking to":
  - `ui/src/app/server.ts` — `Server` service holds a `baseUrl` signal (persisted to
    `localStorage`), exposes `isMock` (true when `baseUrl === ''`, i.e. same-origin), and
    ships `SERVER_PRESETS`.
  - `ui/src/app/server.interceptor.ts` — prefixes relative `/api/...` and `/oauth/...`
    requests with the selected `baseUrl`.
  - `ui/src/app/api.ts` — all calls use relative paths, so they retarget for free.
- Mock-only surface, already gated or isolated:
  - `Api` methods hitting `/api/v1/_mock/*` — `createDevUser`, `listDevUsers`,
    `seedSampleData`, `mockLogin`, and the fault-injection control plane
    (`listFaults` / `addFault` / `deleteFault` / `clearFaults`).
  - Login tabs gated on `server.isMock` (`login.html` lines ~15, 167, 204).
  - Routed mock-only page `dev/faults` (`app.routes.ts`) and `FaultInjection` component.
- Packaging: `pyproject.toml` (hatchling) force-includes `mastodon_mock/_ui_dist/**` via
  `artifacts`, and `hatch_build.py` runs the Angular build before assembling the wheel.
- The published `Dockerfile` `pip install`s `mastodon_mock` from PyPI and sets the
  console script as the entrypoint.
- CI (`.github/workflows/build.yml`) already does `make ui` then `uv run make check-ci`.

---

## Track 1 — "Mocking Bird": a static-only Mastodon web client — IMPLEMENTED

> Status: implemented. Build with `make mockingbird` (override the base href via
> `MOCKINGBIRD_BASE_HREF=/sub-path/`). CI deploys to GitHub Pages via
> `.github/workflows/mockingbird-pages.yml`, currently targeting the custom domain
> `https://mawkingbird.com/`.
>
> How it works in code:
> - **Build seam:** `ui/src/environments/environment.ts` (mock-embedded, `mockTooling:
>   true`, `allowThisServer: true`) vs `environment.mockingbird.ts` (`brand: 'Mocking
>   Bird'`, both flags `false`). Swapped by the `mockingbird` configuration's
>   `fileReplacements` in `ui/angular.json`, which also sets `outputPath:
>   dist-mockingbird` and `baseHref: /`.
> - **Mock surface physically removed from the standalone bundle** (not just runtime-
>   gated) via two more file-replaced files, so no `/api/v1/_mock/*` strings or fault
>   chunk ship:
>   - `ui/src/app/mock-routes.ts` (the `dev/faults` lazy route) → replaced by
>     `mock-routes.mockingbird.ts` (empty array).
>   - `ui/src/app/mock-api.ts` (`MockApi`: the `_mock/*` dev-login / seed / fault
>     methods, moved out of `Api`) → replaced by `mock-api.mockingbird.ts` (throwing
>     stub, no URLs).
> - **Runtime gating** on `environment.mockTooling` for the login Mock/Init tabs
>   (`login.html`) and the Faults / API-Docs nav links (`shell.html`).
> - **No "this server" default:** `SERVER_PRESETS` drops that entry when
>   `!allowThisServer`; the login screen blocks sign-in until an instance is chosen
>   (`Login.needsInstance`).
> - **Branding:** `App` sets the tab title from `environment.brand`; the shell/login
>   render the brand.
> - **Verified:** both builds compile, all 42 UI unit tests pass, the standalone bundle
>   contains no `_mock/` endpoints and no fault chunk, and the default `_ui_dist` build is
>   unchanged (still `baseHref: /_ui/`, retains the full mock surface).

The remainder of this section is the original design rationale.

### Original design

### Goal

Produce a static website (HTML/JS/CSS, no Python, no backend) that is a usable
general-purpose Mastodon web client. The user points it at any real instance
(`mastodon.social`, their own server, etc.), completes a real OAuth flow, and uses the
timelines / compose / notifications UI. It has **zero** mock-server controls.

### Build strategy: one codebase, two build configurations

Rather than fork the UI, introduce a compile-time flavor so the same `ui/` tree builds
either the mock-embedded admin UI (today's behavior) or the standalone Mocking Bird
client. This keeps the two in lockstep and avoids divergence.

1. **Introduce a build-time flag.** Add an Angular file-replacement environment
   (`src/environments/environment.ts` with `mockTooling: true` and
   `environment.mockingbird.ts` with `mockTooling: false`), wired through a new
   `angular.json` build configuration `mockingbird`. Expose it as a small injectable
   (e.g. `AppMode`) so templates and guards can read `mockTooling` without importing the
   raw environment everywhere.

2. **Gate the mock-only surface on `mockTooling`** (not just on `isMock`):
   - Login: hide the **Mock login** and **Initialize / seed** tabs entirely; keep
     **Sign in** (paste token) and the full OAuth flow. The server picker stays, but in
     Mocking Bird it defaults to *a required instance URL* rather than "this server".
   - Routes: exclude `dev/faults` from `app.routes.ts` when `!mockTooling`.
   - Drop the `Api` `_mock/*` methods from the standalone bundle (tree-shaken because the
     fault-injection page and mock login tabs are the only callers, and both are gated).
   - Admin panel: the `/admin/*` routes hit real Mastodon admin endpoints, so they *can*
     stay, but gate them behind a runtime capability check (admin scope on the token).
     Decision needed — see open questions.

3. **Default-server behavior.** In Mocking Bird, `Server` must start with **no** default
   instance (there is no "this server"). The login screen must force the user to choose
   an instance before any API call. Reuse `SERVER_PRESETS` but drop the
   "This server (mastodon_mock)" entry for this flavor.

4. **OAuth in a static context.** The existing `startOAuth()` flow already registers an
   app against the selected instance and redirects the browser to that instance's
   `/oauth/authorize`. Because the redirect and code-exchange happen in the user's
   browser against the *real* instance, this works with no backend. Verify:
   - `redirectUri = new URL('login', document.baseURI)` resolves correctly under the
     static host's base href (set `baseHref` appropriately per deploy target — `/` for a
     custom domain, `/<repo>/` for project Pages).
   - CORS: real Mastodon instances send permissive CORS on the public API and OAuth
     endpoints, so a browser-only client works. Document the known-good instances.

5. **Branding.** Title, favicon, and the in-app "about" copy switch to "Mocking Bird"
   under the `mockingbird` configuration (asset folder swap + `index.html` title token).

### Build & output

- New make target:
  ```
  make mockingbird   # cd ui && npm ci && npm run build -- --configuration mockingbird
                     # outputs to ui/dist-mockingbird/browser (NOT mastodon_mock/_ui_dist)
  ```
- Add a separate `outputPath` for the `mockingbird` configuration so it never collides
  with the wheel's `_ui_dist`.
- `baseHref` is deploy-target specific; make it a build arg / env so the same target can
  emit a Pages build and a custom-domain build.

### Hosting

The output is pure static files. Recommended targets (pick in open questions):
- **GitHub Pages** — a `mockingbird.yml` workflow builds with `baseHref=/<repo>/` and
  deploys via `actions/deploy-pages`. Zero infra.
- **Any static host** (Netlify / Cloudflare Pages / S3) — same artifact, `baseHref=/`.
- Needs SPA routing fallback (serve `index.html` for unknown paths). Pages handles this
  via a `404.html` copy of `index.html`; document the per-host equivalent.

### Acceptance criteria

- `make mockingbird` produces a `browser/` dir with no references to `/api/v1/_mock/`,
  no fault-injection route, no seed/dev-login UI.
- Loading the site with no stored instance forces instance selection.
- A full OAuth round trip against `mastodon.social` logs in and renders the home
  timeline, compose works, notifications load — all with no backend of our own.
- The existing mock-embedded `/_ui/` build is byte-for-byte unchanged (regression guard:
  CI still runs `make ui` and the server tests).

---

## Track 2 — One-click deploy of the mock server (Render / PythonAnywhere / Koyeb / Railway)

### Goal

Let someone stand up a hosted `mastodon_mock` (server + bundled `/_ui/`) on a free or
cheap PaaS with minimal clicks, so they can demo the mock or point a remote client at it.

### Shared runtime contract

All four platforms need the same three things; bake them into the image/process so each
platform manifest is thin:

- **Port binding from `$PORT`.** PaaS platforms inject a `PORT` env var. Ensure the
  server's entrypoint honors it (add a `--port` default of `${PORT:-8000}` or read the
  env in the CLI). *Action: confirm the CLI/uvicorn invocation respects `$PORT`; add it
  if not.*
- **Bind `0.0.0.0`**, not `127.0.0.1`.
- **Persistence expectation.** Free tiers have ephemeral disks. Default to SQLite at a
  writable path; document that data resets on redeploy. Offer an env var for a file path
  or external DB URL where the platform provides a volume.

### Per-platform deliverables

- **Render** — add `render.yaml` (Blueprint) at repo root: a `web` service using the
  Docker image (or a native Python env running `uv` / `pip install .`), `healthCheckPath`
  pointed at `/` or `/api/v2/instance`, `PORT` wired automatically. Add a
  "Deploy to Render" button to the README.
- **Koyeb** — document the `koyeb` CLI / one-click using the GHCR image (Track 3), or a
  buildpack from the repo. Healthcheck on `/`. Provide the exact env (`PORT`, optional DB
  path).
- **Railway** — add `railway.json` / `railway.toml` (or rely on Nixpacks autodetect of
  the Python project). Document the start command and `PORT`. "Deploy on Railway"
  button.
- **PythonAnywhere** — this is the odd one out: no Docker, WSGI-oriented, and FastAPI is
  ASGI. Provide a documented manual path: `pip install mastodon_mock` in a virtualenv,
  then either (a) run under PythonAnywhere's ASGI support if available on the account
  tier, or (b) front the app with an ASGI-to-WSGI shim and note the limitations
  (streaming/SSE will not work under WSGI). Mark streaming as unsupported on PA.

### Deliverable: a `deploy/` directory + docs

- `deploy/render.yaml`, `deploy/railway.toml`, `deploy/koyeb.md`, `deploy/pythonanywhere.md`.
- A `docs/usage/deploy.md` (and a README section) summarizing the matrix: which support
  streaming, persistence behavior, and the one-click button per platform.

### Acceptance criteria

- A fresh Render/Railway/Koyeb deploy boots, serves `GET /api/v2/instance`, and the
  bundled `/_ui/` loads and can dev-login + seed.
- PythonAnywhere doc produces a reachable instance (streaming caveat documented).
- All manifests read `$PORT` and bind `0.0.0.0`.

---

## Track 3 — Publish the Docker image to GitHub Container Registry (ghcr.io) — IMPLEMENTED

> Status: implemented in `.github/workflows/ghcr.yml`, building from a source-built
> multi-stage `Dockerfile`.
>
> - **Dockerfile** is now a 2-stage source build: stage 1 (Python + Node) runs
>   `python -m build` — the hatch hook compiles the Angular UI into `_ui_dist` and
>   produces a wheel; stage 2 is a slim runtime that `pip install`s only the wheel as a
>   non-root user. No PyPI dependency, so the image is buildable/testable from a checkout.
>   A `.dockerignore` keeps the context lean (no `.venv`, `node_modules`, `.git`, …).
>   Default `CMD` is `serve --host 0.0.0.0` with `ENV PORT=8000`.
> - **Workflow** (`release: [released]` + `workflow_dispatch`): logs into `ghcr.io` with
>   `GITHUB_TOKEN`; derives tags via `docker/metadata-action` (semver `X.Y.Z`/`X.Y`/`X`,
>   `latest` on release, `edge` on manual dispatch without a tag, plus the commit SHA);
>   **builds amd64 and `--load`s it for a smoke test** (`--version`, `/api/v2/instance`
>   → 200, `/_ui/` → 200) *before* pushing; then builds+pushes multi-arch
>   `linux/amd64,linux/arm64`. All actions SHA-pinned; passes `zizmor` clean.
> - **Verified locally:** `docker build` succeeds (wheel + UI), and `docker run -e
>   PORT=9099 … serve --host 0.0.0.0 --in-memory` serves the API and bundled UI on the
>   env-provided port.
>
> Note: the image is published to `ghcr.io/matthewdeanmartin/mastodon_mock`. After the
> first publish, mark the GHCR package **public** (one-time, in the package settings) for
> anonymous `docker pull`.

### Original design

### Goal

On each GitHub release, build and push a multi-arch image to
`ghcr.io/<owner>/mastodon_mock`, so Track 2's platforms (and any user) can `docker run`
the mock without building from source.

### Note on the current Dockerfile

Today's `Dockerfile` `pip install`s `mastodon_mock` **from PyPI**, which means the image
can only be built *after* the PyPI release lands and only ever ships released versions.
For a release-triggered registry push that is acceptable, but consider a second build
stage that installs from the local source (`pip install .` after `make ui`) so the image
can be built and smoke-tested in CI *before* publishing — decoupling the image from PyPI
timing. Decision needed — see open questions.

### Workflow: `.github/workflows/ghcr.yml`

- Trigger: `release: [released]` (mirror `release.yml`), plus `workflow_dispatch`.
- Permissions: `packages: write`, `contents: read`.
- Steps (pin all actions by SHA, matching repo convention in existing workflows):
  - Checkout.
  - `docker/login-action` to `ghcr.io` using `GITHUB_TOKEN`.
  - `docker/metadata-action` to derive tags: `latest`, the release semver
    (`X.Y.Z`, `X.Y`, `X`), and the commit SHA.
  - `docker/setup-buildx-action` + `docker/build-push-action` with
    `platforms: linux/amd64,linux/arm64`.
- Add image labels (OCI source/description/license) and confirm the image runs
  `mastodon_mock --help` then can serve (smoke test in the workflow before push, or in a
  separate job).

### Coordination with the release pipeline

`release.yml` already bumps versions on the `release: [released]` event. The ghcr push
should key its semver tags off the same `tag_name` so the image version matches the PyPI
version. If the Dockerfile installs from PyPI (status quo), add a wait/retry for the
version to be installable, or switch to source build (see open question).

### Acceptance criteria

- A GitHub release produces `ghcr.io/<owner>/mastodon_mock:<version>` and `:latest`,
  multi-arch, publicly pullable.
- `docker run -p 8000:8000 ghcr.io/<owner>/mastodon_mock <serve-args>` boots the server
  with the bundled UI.
- README documents the pull/run command and links the package.

---

## Cross-cutting / sequencing

Suggested order:

1. **Track 3 (ghcr)** first — small, self-contained, and it unblocks Track 2's one-click
   deploys (which prefer pulling a prebuilt image over building from source on the PaaS).
2. **Track 2 (deploy manifests)** — depends on confirming `$PORT`/`0.0.0.0` handling and
   benefits from the ghcr image.
3. **Track 1 (Mocking Bird)** — largest, independent of the other two; the build-flavor
   work is the bulk of it.

### Prerequisite verification (do before coding any track)

- **CLI host/port — RESOLVED (2026-06-22):** `mastodon_mock serve` now reads `$HOST` and
  `$PORT` as a fallback when `--host`/`--port` are absent (precedence: flag > env >
  config default of `127.0.0.1:3000`). See `_serve()` / `_env_port()` in `cli.py`; a
  blank/non-integer `$PORT` is ignored with a warning. This lets PaaS hosts that inject
  `$PORT` run the container with no extra flags (the image's default `CMD` is
  `serve --host 0.0.0.0`). When host is `0.0.0.0`/`127.0.0.1` the CLI already derives a
  sensible display `domain` (`localhost:<port>`), so avatar/permalink URLs won't 404.
  Covered by tests in `tests/test_cli_main.py`.
- **`_ui_dist` regression guard (checked 2026-06-22):** the `mockingbird` configuration
  writes to `ui/dist-mockingbird` and does not touch `make ui` / `_ui_dist`; the default
  build still emits `baseHref: /_ui/` with the full mock surface. Confirmed by building
  both flavors.

---

## Open questions

1. **Mocking Bird hosting target** — GitHub Pages only, or also a Netlify/Cloudflare
   config? (Affects `baseHref` strategy and which deploy workflow we author.)
2. **Admin panel in Mocking Bird** — ship the `/admin/*` UI (gated on real admin scope)
   or strip it for a cleaner consumer client?
3. **Docker image source** — keep installing from PyPI (release-only, simplest) or switch
   to a source build (`pip install .`) so images are CI-testable before publish?
4. **Mocking Bird name/repo** — separate repo, or a sub-path / branch of this one for
   Pages? (Affects `baseHref` and the deploy workflow.)
5. **Default instance presets for Mocking Bird** — which instances do we list, and do we
   ship any default or force a blank choice?
