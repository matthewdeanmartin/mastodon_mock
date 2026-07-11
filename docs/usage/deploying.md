# Deploying and Publishing

`mastodon_mock` is primarily a local test dependency, but you can also host it (to demo
the mock or point a remote client at it) and publish its bundled web UI as a standalone
client. This page covers three things:

1. [Running the Docker image](#docker-image) (from GHCR or built locally).
1. [One-click PaaS deploys](#one-click-paas-deploys) (Render, Railway, Koyeb,
   PythonAnywhere) using the manifests in
   [`examples/deploy/`](https://github.com/matthewdeanmartin/mastodon_mock/tree/main/examples/deploy).
1. [Publishing the UI as "Mocking Bird"](#mocking-bird-the-standalone-client), a
   static-only Mastodon web client.

!!! warning "Not a production server"
The mock has no real security (see
[What Is and Isn't Mocked](../reference/coverage.md)). Host it for demos and testing,
not as a real instance, and don't put private data in it.

## Docker image

The image bundles the server and the web UI (served at `/_ui/`). It honors `$PORT` and
binds whatever host you pass, so it works as-is on most container platforms.

### Pull from GHCR

Released versions are published to the GitHub Container Registry:

```bash
docker pull ghcr.io/matthewdeanmartin/mastodon_mock:latest
docker run --rm -p 8000:8000 ghcr.io/matthewdeanmartin/mastodon_mock:latest
```

Then open `http://127.0.0.1:8000/_ui/`. Tags include `latest`, the release semver
(`X.Y.Z`, `X.Y`, `X`), and the commit SHA.

The default command is `serve --host 0.0.0.0` with `PORT=8000`. Override it to customize:

```bash
# A persistent file-backed DB on a mounted volume, on a custom port.
docker run --rm -p 9000:9000 -e PORT=9000 \
  -v "$PWD/data:/data" \
  ghcr.io/matthewdeanmartin/mastodon_mock:latest \
  serve --host 0.0.0.0 --database /data/mock.sqlite

# A rich demo community.
docker run --rm -p 8000:8000 \
  ghcr.io/matthewdeanmartin/mastodon_mock:latest \
  serve --host 0.0.0.0 --in-memory --demo
```

### Build it yourself

The repository `Dockerfile` is a multi-stage source build (it compiles the UI and builds
a wheel — no PyPI dependency), so you can build from a checkout:

```bash
docker build -t mastodon_mock .
docker run --rm -p 8000:8000 mastodon_mock
```

## Binding: host and port

`mastodon_mock serve` resolves its bind address with this precedence:

1. The `--host` / `--port` flags, if given.
1. The `$HOST` / `$PORT` environment variables.
1. The config file (default `127.0.0.1:3000`).

PaaS platforms inject `$PORT` (and expect a public bind), which is why the image defaults
to `serve --host 0.0.0.0` and reads `$PORT`. A blank or non-numeric `$PORT` is ignored
with a warning rather than failing to start.

## One-click PaaS deploys

Ready-made manifests live in
[`examples/deploy/`](https://github.com/matthewdeanmartin/mastodon_mock/tree/main/examples/deploy).
All of them
assume an **ephemeral** filesystem on free tiers: the SQLite database resets on every
redeploy. Mount a volume or point `--database` at persistent storage if you need data to
survive (see each platform's notes).

### Per-platform manifests

| Platform | Manifest | Notes |
|---|---|---|
| Render | `examples/deploy/render.yaml` | Blueprint; `$PORT` wired automatically; health check on `/api/v2/instance`. |
| Railway | `examples/deploy/railway.toml` | Uses the GHCR image; set the start command shown in the file. |
| Koyeb | `examples/deploy/koyeb.md` | One-click / CLI using the GHCR image. |
| PythonAnywhere | `examples/deploy/pythonanywhere.md` | Manual ASGI setup; **streaming/SSE is unsupported** under WSGI. |

See
[`examples/deploy/README.md`](https://github.com/matthewdeanmartin/mastodon_mock/tree/main/examples/deploy)
for the capability matrix (streaming support, persistence behavior) and step-by-step
instructions per platform.

## Mocking Bird: the standalone client

The same web UI can be built as **Mocking Bird** — a static-only Mastodon web client with
no mock-server tooling. It runs as a plain static site (no backend of its own) and the
user points it at any real Mastodon instance, signing in via OAuth or a pasted token.

Build it locally:

```bash
make mockingbird
# Output: ui/dist-mockingbird/browser — host these static files anywhere.
```

For sub-path hosting, override the base href:

```bash
make mockingbird MOCKINGBIRD_BASE_HREF=/mastodon_mock/
```

### GitHub Pages

The `.github/workflows/mockingbird-pages.yml` workflow builds and deploys Mocking Bird to
GitHub Pages on every push that touches `ui/`. To enable it once:

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
1. Push a change under `ui/` (or run the workflow manually).

The workflow now targets the custom domain [`mawkingbird.com`](https://mawkingbird.com/),
builds with `base href=/`, writes a `CNAME` file into the published artifact, and adds a
`404.html` SPA fallback so deep links resolve on reload.

### How the two builds differ

| | Mock-embedded (`/_ui/`) | Mocking Bird (static) |
|---|---|---|
| Served by | the mock server | any static host |
| Mock login / sample-data seeding | yes | removed |
| Fault injection page | yes | removed |
| `_mock/*` control-plane calls | present | compiled out |
| Default instance | "this server" | none — you must pick one |

Both are produced from the same `ui/` source via Angular build configurations; see
`ui/src/environments/` and `spec/publish.md` for the mechanism.
