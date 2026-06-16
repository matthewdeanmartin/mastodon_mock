# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Bundled Angular UI served at `/_ui/` when built, including timeline browsing, token-based
  login, dev-user helpers, sample-data seeding, and admin account/report/domain-block views.
- Bulk sample-data generation through `mastodon_mock gen-data` and
  `POST /api/v1/_mock/sample_data`, with presets and JSON generation reports.
- Admin / moderation API coverage for accounts, reports, domain blocks/allows,
  email-domain blocks, canonical-email blocks, IP blocks, plus shaped admin
  trends/measures/dimensions/retention responses.
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

[unreleased]: https://github.com/matthewdeanmartin/mastodon_mock/commits/main
