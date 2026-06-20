# Admin UI and Admin API

`mastodon_mock` ships two related admin surfaces:

- a bundled Angular UI served at `/_ui/` when the UI bundle is present;
- Mastodon-shaped admin and moderation API routes under `/api/v1/admin/*` and
  `/api/v2/admin/*`.

Both are for local testing and development. They are not a security model.

## Bundled UI

Run the server and open the UI:

```bash
mastodon_mock serve --in-memory
```

Then visit:

```text
http://127.0.0.1:3000/_ui/
```

If the packaged UI bundle is available, `GET /` also includes:

```json
{"ui": "/_ui/"}
```

If the bundle has not been built in an editable checkout, the server still starts and the
`/_ui/` mount is skipped. Build it from source with:

```bash
uv run make ui
```

The UI includes:

- login with any seeded access token;
- mock-only dev user creation for regular and admin users;
- sample-data generation from the login screen;
- home, public, notification, search, favourites, bookmarks, lists, tag, profile, and
  thread views;
- admin views for accounts, reports, and domain blocks.

## Dev Login Helpers

The UI uses mock-only helper endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/_mock/dev_user` | Create a local account and token. Body may include `username`, `display_name`, and `admin`. |
| `GET /api/v1/_mock/dev_users` | List local accounts that have a usable token, returning the newest token per account. |
| `POST /api/v1/_mock/sample_data` | Generate a capped sample cohort into the running database. |
| `POST /api/v1/_mock/reset` | Drop all tables, recreate them, and reapply seed data. |
| `POST /api/v1/_mock/login` | Issue a fresh token for an existing local username. |

`admin: true` on `dev_user` sets the account role to `admin`. The mock API itself does not
enforce roles, but the UI uses `verify_credentials.role` to decide whether to show the
admin navigation.

## Admin API Auth

Admin endpoints require an authenticated account, but they do not enforce admin,
moderator, or owner roles. Any valid user token can call them. This matches the project's
testing goal: exercise client code paths and response shapes without pretending to be a
production authorization system.

## Stateful Admin Endpoints

These routes persist state and are safe to assert against in tests:

| Area | Routes |
|---|---|
| Accounts | `GET /api/v2/admin/accounts`, `GET /api/v1/admin/accounts`, single-account fetch, enable, approve, reject, unsilence, unsuspend, unsensitive, delete, and `POST /api/v1/admin/accounts/{id}/action`. |
| Reports | `POST /api/v1/reports`, admin report list/fetch, assign to self, unassign, resolve, and reopen. |
| Domain blocks | list, fetch, create, update, and delete under `/api/v1/admin/domain_blocks`. |
| Domain allows | list, fetch, create, and delete under `/api/v1/admin/domain_allows`. |
| Email domain blocks | list, fetch, create, and delete under `/api/v1/admin/email_domain_blocks`. |
| Canonical email blocks | list, fetch, test, create, and delete under `/api/v1/admin/canonical_email_blocks`. |
| IP blocks | list, fetch, create, update, and delete under `/api/v1/admin/ip_blocks`. |
| Announcements | list drafts/published announcements, create, publish, unpublish, and delete. |

Account listing supports the common filters used by Mastodon.py, including local/remote
origin, domain, username, display name, email, IP, staff permissions, and moderation status.

## Derived and Shaped Admin Surfaces

Admin trending tags and statuses are derived from local hashtag usage and favourite
counts. They are deterministic fixture rankings, not Mastodon's production ranking
algorithm.

These routes remain shallow:

- admin trending links return an empty list;
- trend approve/reject routes do not persist review decisions;
- admin measures return zero-valued measures for requested keys;
- admin dimensions return empty data arrays for requested keys;
- admin retention returns an empty list.

Moderation flags and block-list records persist, but most do not yet affect ordinary
login, posting, timeline, signup, or discovery behavior.

See [What Is and Isn't Mocked](../reference/coverage.md) for the full coverage summary.
