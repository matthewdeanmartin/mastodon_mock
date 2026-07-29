---
name: verify
description: Build, launch and drive this repo's app (mock server + Angular UI) to verify changes at runtime.
---

# Verifying mastodon_mock / Mockingbird changes at runtime

## Build + launch

```bash
cd ui && npm run build           # embedded UI -> mastodon_mock/_ui_dist (REQUIRED before serving UI changes)
uv run mastodon_mock serve --in-memory --demo --port 8899   # run in background
```

**The SPA is served at `http://127.0.0.1:8899/_ui/`** — NOT at `/`. Bare `/` 307-redirects
to `/_ui/`, but deep links must be `/_ui/home`, `/_ui/settings/...` etc. Hitting `/home`
returns the API's JSON 404.

## Login (no UI interaction needed)

`--demo` seeds dev users whose tokens are `<username>_token` (see
`GET /api/v1/_mock/dev_users`). Seed localStorage and reload:

```python
page.goto("http://127.0.0.1:8899/_ui/login")
page.evaluate("localStorage.setItem('mastodon_mock_token','alan_token')")
page.evaluate("localStorage.setItem('mastodon_mock_server','')")
page.goto("http://127.0.0.1:8899/_ui/home")
```

## Driving the browser

No Playwright in the repo. Make a throwaway venv and use system Edge (no browser download):

```bash
uv venv pwenv && uv pip install --python pwenv/Scripts/python.exe playwright
# python: sync_playwright().chromium.launch(channel="msedge", headless=True)
```

## Gotchas

- **`npm run test:ci` wipes `_ui_dist`. Always build AFTER testing, never before.**
  The Angular test builder cleans the same output path the app build writes to, leaving
  `_ui_dist/browser` holding only `vendor/`. Symptom: `/_ui/` 404s right after a full quality
  gate that ended with tests. Check with
  `(Get-ChildItem mastodon_mock\_ui_dist\browser | Measure-Object).Count` — ~190 is healthy,
  1 means it was cleaned. Correct order: `lint` → `test:ci` → `build` → restart server.
  Worse, the test builder's cleanup fires **asynchronously**, so it can wipe a build that
  finished *after* `test:ci` returned. Chaining `test:ci; build` in one command is not safe.
  The reliable sequence before driving the app is:
  `Get-Process node | Stop-Process -Force` → `npm run build` → check the count → restart.
- **Restart the server after every rebuild.** `ui.py` resolves `_ui_dist/browser` at import,
  so a server started against a missing dist keeps 404ing no matter how often you rebuild.
- A CORS-enabled local test server (e.g. for RSS feeds) must send
  `Access-Control-Allow-Origin: *`; plain `python -m http.server` does not.
- `text=fail whale` matches the footer's "Fail whale" demo link — check for the
  `app-fail-whale` overlay element instead.
- After an in-page action, wait for the *new* state (`:has-text(...)`), not just the
  selector — stale text races Angular's re-render.
- Bluesky live checks: `app.bsky.feed.getPostThread` / `getLikes` read the AppView,
  which indexes asynchronously — a record you just created may not appear for seconds.
  Verify writes via `com.atproto.repo.listRecords` against the PDS instead (immediate),
  and ALWAYS delete test records by listRecords lookup, not by remembering uris.
- Real Bluesky credentials: `.env` (gitignored) has `BSK_APP_PASSWORD`; handle is
  mistersql.bsky.social. Never echo the password or tokens into logs.
