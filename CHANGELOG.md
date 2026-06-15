# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-26

### Added

- Initial release of `mastodon_mock`, a stateful FastAPI + SQLite mock of the Mastodon
  REST API, driveable by real clients including Mastodon.py.
- Auth & apps: app registration, `client_credentials` and `refresh_token` OAuth grants,
  token revocation, self-service account creation, and OAuth server metadata.
- Accounts: profiles, `verify_credentials`, relationships, follow/unfollow, mute/block,
  and account search.
- Statuses: posting, editing, deleting, replies, context, reblogs, favourites, bookmarks,
  polls, scheduled statuses, and quotes.
- Timelines: home, public (with `local`/`remote` filters), hashtag, and list timelines,
  with cursor pagination and `Link` headers.
- Lists, content filters (v1 + v2), notifications (including grouped notifications),
  conversations, media upload/update, and instance metadata.
- `mastodon_mock serve` and `mastodon_mock db upgrade` CLI commands with TOML-based
  configuration and Alembic migrations.
