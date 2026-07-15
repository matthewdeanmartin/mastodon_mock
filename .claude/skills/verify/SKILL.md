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
