# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-18
### Added
- Support for python 3.10, 3.11, 3.12
- Websockets support
- More oauth login machinery

### Fixed
- Missing paging for some end points
- More missing endpoints
- Missing v1/v2 endpoints

## [0.2.0] - 2026-06-17
### Added
- More endpoints, SSE style streaming.
- More features visible via UI

## [0.1.0] - 2026-06-16
### Added
- Added UI
- Added bulk sample data generation

### Fixed
- Improved performance

## [0.0.1] - 2026-06-15
### Added
- Initial release of `mastodon_mock`, a stateful FastAPI + SQLite mock of the Mastodon REST API, driveable by real clients including Mastodon.py.
- Auth & apps: app registration, `client_credentials` and `refresh_token` OAuth grants, token revocation, self-service account creation, and OAuth server metadata.
- Accounts: profiles, `verify_credentials`, relationships, follow/unfollow, mute/block, and account search.
- Statuses: posting, editing, deleting, replies, context, reblogs, favourites, bookmarks, polls, scheduled statuses, and quotes.
- Timelines: home, public (with `local`/`remote` filters), hashtag, and list timelines, with cursor pagination and `Link` headers.
- Lists, content filters (v1 + v2), notifications (including grouped notifications), conversations, media upload/update, and instance metadata.
- `mastodon_mock serve` and `mastodon_mock db upgrade` CLI commands with TOML-based configuration and Alembic migrations.
- Admin / moderation API (`mastodon/admin.py`): account listing & moderation actions (enable/approve/reject/silence/suspend/sensitive/delete), reports (create + admin queue/assign/resolve/reopen), domain blocks/allows, email-domain & canonical-email blocks, IP blocks, and shaped stubs for admin trends/measures/dimensions/retention.
- Auth remains faked (no role enforcement), consistent with the project's non-goals.
- Hashtag follow/unfollow (`tag_follow`/`tag_unfollow`), `tag()` fetch, and a real `followed_tags` listing backed by a new `followed_tags` table.
- Featured hashtags: `featured_tag_create`/`featured_tag_delete`, the newer `tag_feature`/`tag_unfeature` aliases, `featured_tag_suggestions`, and `featured_tags` (own + per-account), backed by a new `featured_tags` table. `tag()` now reports `featuring`, and usage counts are derived from the account's statuses.
- Quote moderation (Mastodon 4.5+): `status_quote_revoke` (sets a quote's `state` to `revoked` and hides the quoted status) and `status_update_quote_approval_policy` (`public`/`followers`/`nobody`, forced to `nobody` for private/direct statuses). Statuses now expose `quote.state` and `quote_approval_policy`.
- Discovery surfaces now return realistic, data-derived content instead of empty stubs: instance `activity`/`peers`/`domain_blocks`, trending tags & statuses, follow suggestions, endorsements, featured tags (own + per-account) and followed tags. Custom emojis and translation languages return correctly-shaped static data, the notification policy includes `for_bots`, and the notification-requests family is fully wired. Shapes were validated against a live `mastodon.social`.
