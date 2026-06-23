# Deploy to Koyeb

[Koyeb](https://www.koyeb.com/) runs the prebuilt GHCR image directly. It injects `$PORT`
and expects the app to listen on `0.0.0.0:$PORT`, which the image's default command does.

## Option A — `koyeb` CLI

```bash
koyeb app init mastodon-mock \
  --docker ghcr.io/matthewdeanmartin/mastodon_mock:latest \
  --ports 8000:http \
  --routes /:8000 \
  --instance-type free \
  --checks 8000:http:/api/v2/instance
```

Koyeb sets `$PORT`; the container's default command is `serve --host 0.0.0.0`, which
binds it. To use a fixed port instead, also pass:

```bash
  --env PORT=8000
```

## Option B — Dashboard

1. **Create Service → Docker image**.
2. Image: `ghcr.io/matthewdeanmartin/mastodon_mock:latest`.
3. Exposed port: `8000` (HTTP), route `/`.
4. Health check: HTTP, path `/api/v2/instance`.
5. Instance type: Free. Deploy.

## Persistence

Koyeb's free instances are ephemeral — the SQLite DB resets on redeploy. To persist data,
attach a volume (paid plans), mount it at `/data`, and override the command:

```
mastodon_mock serve --host 0.0.0.0 --database /data/mock.sqlite
```

## Demo data

To boot with a rich demo community, override the command with:

```
mastodon_mock serve --host 0.0.0.0 --in-memory --demo
```
