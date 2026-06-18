# Troubleshooting

## `localhost:3443` fails to connect, but `127.0.0.1:3443` works (or vice versa)

**Symptom**: a real Mastodon client (Whalebird, Fedistar, ...) connects fine when you
enter `127.0.0.1:3443`, but entering `localhost:3443` gives a generic connection error
— and nothing shows up in the `mastodon_mock` server log at all for the failing case,
meaning the request never reached the server.

**Cause**: `localhost` can resolve to either the IPv4 loopback (`127.0.0.1`) or the
IPv6 loopback (`::1`), and the OS decides which one to try (often IPv6 first on modern
Windows/macOS). `mastodon_mock serve` — including `make serve-https` — binds a single
address, `127.0.0.1` by default. If the client's `localhost` resolution lands on `::1`
and nothing is listening there, the connection is refused before any HTTP/TLS exchange
happens, so it never reaches the app or its logs.

You can confirm this is what's happening:

```bash
netstat -ano | grep ":3443" | grep LISTENING
```

If you only see `127.0.0.1:3443` (no `[::1]:3443` or `[::]:3443` line), the server
isn't listening on the IPv6 loopback at all.

**Why we don't just bind `::` (the IPv6 wildcard)**: on Linux/macOS, binding `::`
typically also accepts IPv4 connections transparently (dual-stack). On Windows,
that's not reliable — binding `::` can leave `127.0.0.1` connections failing outright,
trading one broken address for another rather than fixing both. Running two listeners
(one per address family) works but adds real complexity for a dev convenience target,
so `mastodon_mock` doesn't attempt it. This is an OS/networking property of loopback
dual-stack behavior, not a bug in the mock's request handling.

**Workarounds** (pick one):

- **Always type `127.0.0.1:3443` in the client**, not `localhost:3443`. This is the
  simplest fix and what `make serve-https`'s default bind already supports.

- **Force `localhost` to resolve to IPv4** by adding an explicit entry to your hosts
  file (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` on
  macOS/Linux):

  ```
  127.0.0.1 localhost
  ```

  This is a one-time, system-wide change — it affects how *every* app on the machine
  resolves `localhost`, not just `mastodon_mock`. Use this if you'd rather fix it once
  than remember to type the literal IP.

- **Bind explicitly to `::1`** if you specifically need the IPv6 loopback to work and
  don't need `127.0.0.1` at the same time:

  ```bash
  mastodon_mock serve --host ::1 --port 3443 --ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem
  ```

  Note this trades the problem the other direction — `127.0.0.1:3443` will then fail
  instead.

See [HTTPS and Real Mastodon Clients](usage/https-and-real-clients.md) for the rest of
the HTTPS/cert setup this interacts with.

## Client connects but immediately disconnects / shows a generic error after the first request

If the server log shows a successful `GET /` (or similar) followed by silence and the
client still reports a generic failure, the client likely made a *second* request that
failed in a way it doesn't surface clearly (e.g. a missing endpoint, a cert it
ultimately rejected after the initial handshake, or a JSON shape it didn't expect).
Tail the server log while reproducing and look for the next request after the
successful one — a `404`, `422`, or another connection-reset immediately after a
`200` is usually the real failure, not the first request that succeeded.

## `ConnectionResetError [WinError 10054]` spam in the server log

This is benign asyncio/Windows noise from a client aborting a connection instead of
closing it cleanly (common for SSE/streaming clients with short read timeouts) — not a
server error. `mastodon_mock serve` already suppresses this traceback on Windows; if
you still see it, make sure you're running a version of `mastodon_mock` that includes
the fix (check `mastodon_mock --version`).
