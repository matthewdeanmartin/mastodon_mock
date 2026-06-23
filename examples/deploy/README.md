# One-click / minimal-effort deploys

Manifests and notes for hosting `mastodon_mock` (server + bundled `/_ui/` web UI) on a
few free-or-cheap platforms. These are for **demos and remote testing**, not production —
the mock has no real security.

See the [Deploying and Publishing](../../docs/usage/deploying.md) docs page for the full
write-up; this directory holds the copy-pasteable bits.

## Runtime contract (all platforms)

The image/CLI already satisfies what these platforms need:

- **Reads `$PORT`** (and `$HOST`) when no `--port`/`--host` flag is given. PaaS platforms
  inject `$PORT`; the container's default command is `serve --host 0.0.0.0`.
- **Binds `0.0.0.0`** so the container is reachable.
- **Health check:** `GET /api/v2/instance` returns `200` once the server is up.

## Capability matrix

| Platform | Mechanism | Streaming (SSE/WS) | Persistence on free tier |
|---|---|---|---|
| Render | Docker (`render.yaml` blueprint) | ✅ | Ephemeral; add a disk for persistence |
| Railway | GHCR image (`railway.toml`) | ✅ | Ephemeral; add a volume for persistence |
| Koyeb | GHCR image (`koyeb.md`) | ✅ | Ephemeral; add a volume for persistence |
| PythonAnywhere | Manual ASGI/WSGI (`pythonanywhere.md`) | ❌ (WSGI) | Persistent home directory |

"Ephemeral" means the SQLite database resets on each redeploy. To keep data, mount a
volume and point the server at it with `serve --host 0.0.0.0 --database /data/mock.sqlite`.

## Image reference

The manifests pull `ghcr.io/matthewdeanmartin/mastodon_mock:latest`. Pin a specific
version tag (`:X.Y.Z`) for reproducible deploys. Render's blueprint builds from the
repository `Dockerfile` instead, so it doesn't depend on a published image.

## Files

- `render.yaml` — Render Blueprint (Docker web service).
- `railway.toml` — Railway service config (GHCR image).
- `koyeb.md` — Koyeb one-click / CLI instructions.
- `pythonanywhere.md` — PythonAnywhere manual setup (with the streaming caveat).
