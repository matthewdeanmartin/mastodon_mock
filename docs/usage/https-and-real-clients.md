# HTTPS and Real Mastodon Clients (Whalebird, Fedistar, ...)

`mastodon_mock serve` speaks plain HTTP by default, which is fine for Mastodon.py and
test suites but not for desktop/mobile Mastodon clients. Those clients connect to the
domain you enter over HTTPS regardless of any scheme you type, so pointing one at a
plain-HTTP mock fails immediately — you'll see `Invalid HTTP request received` in the
server log (the client's TLS handshake hitting an HTTP parser).

This page covers getting a trusted local cert and running the mock over HTTPS so a real
client (not just Mastodon.py) can connect to it.

## Why a plain self-signed cert isn't enough

A bare `openssl req -x509 ...` self-signed cert works in a browser tab (after clicking
through a warning), but Electron-based clients (Whalebird, Fedistar) commonly **refuse
to connect at all** rather than warn-and-allow. The fix is
[mkcert](https://github.com/FiloSottile/mkcert): it creates a local Certificate
Authority and installs it into your OS/browser trust stores once, then issues
leaf certs signed by that CA. Clients trust the connection outright — no per-cert
override needed.

## One-time setup

Install mkcert, then let it create and trust a local CA:

```bash
# Windows (scoop)
scoop bucket add extras
scoop install extras/mkcert

# macOS
brew install mkcert

# Linux
# see https://github.com/FiloSottile/mkcert#linux

mkcert -install
```

`mkcert -install` adds a CA to your system/browser trust stores. Do this once per
machine; you don't need to repeat it for new certs.

If mkcert isn't installed, the cert-generation script below falls back to a plain
openssl self-signed cert — it'll work for `curl -k` and Mastodon.py, but expect
Electron clients to reject it outright.

## Generating the cert

```bash
make dev-cert
```

This runs `scripts/gen_dev_cert.sh`, which:

- Skips generation if `.dev_certs/localhost-key.pem` and `.dev_certs/localhost-cert.pem`
  already exist (idempotent — safe to run repeatedly).
- Uses `mkcert -key-file ... -cert-file ... localhost 127.0.0.1 ::1` when mkcert is on
  `PATH`, producing a cert trusted by your OS.
- Falls back to an `openssl req -x509 ...` self-signed cert otherwise.

You can also call the script directly with a custom output directory:

```bash
bash scripts/gen_dev_cert.sh /path/to/certs
```

`.dev_certs/` is git-ignored — it's machine-local, regenerable state, not something to
commit.

## Running the server over HTTPS

```bash
make serve-https
```

This depends on `dev-cert` (so it generates the cert first if needed), then runs:

```bash
mastodon_mock serve --in-memory --demo --port 3443 \
  --ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem
```

i.e. the demo-seeded in-memory instance from the [Quick Start](quickstart.md), over TLS
on port 3443. Point your client at `https://localhost:3443` (or `127.0.0.1:3443`).

For a client that strips non-standard ports from a typed domain (e.g.
tuba-windows-portable), use `make serve-https-443` instead to bind `:443` directly so
no port needs to appear in the URL. Binding a port below 1024 usually needs elevation —
on Windows, run it from an Administrator shell; on Linux/macOS, prefix with `sudo` or
grant the interpreter `CAP_NET_BIND_SERVICE`.

If a client fails with no useful error message, `make serve-https-verbose` runs the
same server at uvicorn's `trace` log level — every request's method/path/status and
the ASGI lifecycle are logged, which is often enough to spot a missing endpoint, an
unexpected method, or a request that never arrives at all (vs. one that 4xxs).

To run with your own flags instead of the `make` target, any `serve` invocation accepts:

- `--ssl-keyfile PATH` - the TLS private key.
- `--ssl-certfile PATH` - the TLS certificate.
- `--ssl-keyfile-password PASSWORD` - only needed for an encrypted key file.
- `--domain NAME` - override the public domain used to build avatar/header/status
  URLs (takes priority over auto-derivation and any config file value).

```bash
mastodon_mock serve --ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem
```

## Reachable URLs: the domain auto-derivation

Account avatars/headers and status permalinks are built from `config.domain` ("mock.local" by default), which isn't resolvable on a fresh machine. When `domain` is left
at its default, `serve` automatically derives a reachable one from the actual bind
address instead — e.g. `localhost:3443` for `--port 3443` — so generated URLs are
loadable rather than pointing nowhere. Pass `--domain` explicitly to override this
(takes priority over auto-derivation and any config file value), e.g. for a named
cert + hosts-file setup below.

## A named domain, for clients that reject bare IPs/localhost

Some clients (e.g. tuba-windows-portable) strip non-standard ports from a typed
domain, or behave oddly with `localhost`/`127.0.0.1`. The fix is a real-looking
hostname mapped to `127.0.0.1` in your hosts file, with a cert issued for that exact
name:

1. Add a line to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows,
   `/etc/hosts` on macOS/Linux) — requires admin/root to edit:

   ```
   127.0.0.1 mock.local
   ```

1. Generate a cert covering that name:

   ```bash
   make dev-cert-named
   ```

   This calls `scripts/gen_dev_cert.sh .dev_certs mock.local`, adding `mock.local` to
   the cert's SAN list alongside the usual `localhost`/`127.0.0.1`/`::1`. It detects
   when an existing cert doesn't cover the requested name and regenerates
   automatically (rather than silently reusing a stale one). Override the name with
   `make dev-cert-named MOCK_DOMAIN=example.local` if you mapped something else.

1. Serve with `--domain` set to match, and (if you also need a portless URL) on `:443`:

   ```bash
   make serve-https-443-named
   ```

   Point the client at `https://mock.local` (no port). Override the domain the same
   way: `make serve-https-443-named MOCK_DOMAIN=example.local`.

## `scripts/basic_checks.sh`

A separate, unrelated smoke-test script lives at `scripts/basic_checks.sh`, run via:

```bash
make smoke
```

It exercises the CLI argument parser (`--help`, `--version`, subcommand routing) and
prints a pass/fail count; it does not start a server or touch HTTPS. Useful as a quick
sanity check that the `mastodon_mock` console script is wired up correctly after an
install.

## Troubleshooting

- **Client still refuses to connect after `make serve-https`**: confirm `mkcert -install`
  ran successfully (it prints "The local CA is now installed in the system trust
  store!"). If `.dev_certs/` already had an openssl-generated cert from before mkcert
  was installed, delete `.dev_certs/` and rerun `make dev-cert` to regenerate with mkcert.
- **`curl` rejects the cert even though the client doesn't**: on Windows, `curl` may use
  `schannel`, which is stricter about revocation checking than browsers/Electron for a
  cert with no CRL/OCSP endpoint (expected for a local dev CA). Use
  `curl --ssl-no-revoke` or `curl -k` when testing manually with curl.
- **Port already in use**: `make serve-https` always binds `:3443`. If a previous
  instance is still running, stop it (Ctrl+C in its terminal, or find and kill the
  process bound to that port) before starting another.
- **`127.0.0.1:3443` connects but `localhost:3443` doesn't (or vice versa)**: see
  [Troubleshooting](../troubleshooting.md) — this is an IPv6/IPv4 loopback resolution
  quirk, not a cert problem.

## Next steps

- [Troubleshooting](../troubleshooting.md) - localhost/IPv6 connection issues and other
  common failures with real clients.
- [Quick Start](quickstart.md) - running the mock over plain HTTP for tests/Mastodon.py.
- [Writing Tests Against the Mock](writing-tests.md) - fixtures and examples.
