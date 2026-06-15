# Overview

`mastodon_mock` is a stateful mock of the [Mastodon](https://docs.joinmastodon.org/api/)
REST API. It is a real [FastAPI](https://fastapi.tiangolo.com/) application backed by a
small SQLAlchemy model layer and a SQLite database (in-memory by default, optionally
on-disk). Because it speaks the actual HTTP API and persists state across requests, you
can drive it with any real Mastodon client — it is tested against
[Mastodon.py](https://github.com/halcy/Mastodon.py) — and get deterministic, fast,
side-effect-free behaviour suitable for automated tests and local development.

## What it covers

The mock implements the high-traffic surface of the Mastodon API, including:

- **Auth & apps** — `POST /api/v1/apps`, the `client_credentials` and `refresh_token`
  OAuth grants, token revocation, self-service account creation, and OAuth server
  metadata. Tokens are random opaque strings mapped 1:1 to accounts; security is
  deliberately faked.
- **Accounts** — profiles, `verify_credentials`, statuses, relationships, follow/unfollow,
  mute/block, and account search.
- **Statuses** — posting, editing, deleting, replies, context, reblogs, favourites,
  bookmarks, polls, scheduled statuses, and quotes.
- **Timelines** — home, public (with `local`/`remote` filters), hashtag, and list
  timelines, with cursor pagination and `Link` headers.
- **Lists, filters (v1 + v2), notifications (incl. grouped), conversations, media, and
  instance metadata.**

## How configuration is resolved

`MastodonMockConfig.load()` reads configuration in this precedence order:

1. An explicit `--config` path, or `./.mastodon_mock.toml` if present — the whole document.
1. A `[tool.mastodon_mock]` table in `./pyproject.toml`.
1. Built-in defaults (an in-memory database seeded with a single `testuser` account).

Configuration controls the mocked Mastodon version, instance domain/title/description,
database path, server bind address, rate-limit behaviour, and the seed data (accounts,
follows) created on startup.

## Running

```bash
mastodon_mock serve --in-memory
```

See the [top-level README](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/README.md) for installation and the full CLI reference.
