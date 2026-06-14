# Data Model

All tables live in `mastodon_mock/db/models.py` as SQLAlchemy 2.0 declarative models
(`class Foo(Base): __tablename__ = "foo"` with `Mapped[...]` / `mapped_column(...)`).

## ID strategy

Mastodon IDs are strings that look like integers (snowflake-ish, monotonically
increasing, "Mastodon's `IdType`"). Mastodon.py's `IdType` is `Union[str, int]` and most
comparisons are done as strings.

- `mastodon_mock/ids.py` provides `next_id() -> str`: a simple monotonically increasing
  counter seeded from current epoch milliseconds (so IDs sort correctly and look
  plausible), stored as a `BigInteger` primary key in each table but **serialized as a
  string** in API responses (`str(row.id)`).
- All FK columns are `BigInteger`.
- All API responses use `str(...)` for any `id` / `*_id` field, per `MaybeSnowflakeIdType`.

## Tables

### `accounts`

Maps to Mastodon `Account`. One row per local account (including ones marked "remote"
for seeding purposes — see [00-overview.md](00-overview.md) federation non-goal).

| column                | type           | notes |
|-----------------------|----------------|-------|
| `id`                   | BigInteger PK | |
| `username`             | String, unique | local part, no `@domain` |
| `domain`               | String, nullable | NULL for local accounts; set for "looks remote" seeded accounts |
| `display_name`         | String | |
| `note`                 | Text | bio/profile HTML, default `""` |
| `locked`               | Boolean | default `False` |
| `bot`                  | Boolean | default `False` |
| `discoverable`         | Boolean, nullable | |
| `group`                | Boolean | default `False` |
| `indexable`            | Boolean | default `False` |
| `hide_collections`     | Boolean, nullable | |
| `avatar_url`           | String, nullable | static placeholder if unset |
| `header_url`           | String, nullable | |
| `created_at`           | DateTime | |
| `fields`               | JSON | list of `{name, value, verified_at}` |
| `default_privacy`      | String, default `"public"` | from `source.privacy` |
| `default_sensitive`    | Boolean, default `False` | |
| `default_language`     | String, nullable | |

Derived/computed at serialization time (not stored): `followers_count`,
`following_count`, `statuses_count` — computed via `COUNT(*)` over `relationships` /
`statuses` tables. `acct` is computed as `username` if `domain is None` else
`f"{username}@{domain}"`. `url` / `uri` are computed as
`f"https://{config.domain}/@{acct}"`.

### `oauth_apps`

Maps to `Application` / `/api/v1/apps`. Created by `create_app()` (Mastodon.py
`Mastodon.create_app`).

| column          | type    | notes |
|------------------|---------|-------|
| `id`             | BigInteger PK | |
| `client_id`      | String, unique | random token |
| `client_secret`  | String | random token |
| `name`           | String | `client_name` |
| `website`        | String, nullable | |
| `redirect_uris`  | JSON | list of strings |
| `scopes`         | JSON | list of strings |

### `oauth_tokens`

Maps a bearer token to an account + app + scopes. This is the entire "auth" model — see
[04-auth.md](04-auth.md).

| column        | type    | notes |
|---------------|---------|-------|
| `id`           | BigInteger PK | |
| `access_token` | String, unique | what `Authorization: Bearer <...>` carries |
| `app_id`       | FK → `oauth_apps.id`, nullable | |
| `account_id`   | FK → `accounts.id`, nullable | NULL = "client credentials" token (app-only, no user) |
| `scopes`       | JSON | list of strings |
| `created_at`   | DateTime | |

### `statuses`

Maps to Mastodon `Status`.

| column                  | type     | notes |
|--------------------------|----------|-------|
| `id`                     | BigInteger PK | |
| `account_id`             | FK → `accounts.id` | |
| `content`                | Text | HTML-wrapped, e.g. `<p>{text}</p>` |
| `text`                   | Text | raw source text (for `status_source`/edits) |
| `created_at`             | DateTime | |
| `edited_at`              | DateTime, nullable | |
| `in_reply_to_id`         | FK → `statuses.id`, nullable | |
| `in_reply_to_account_id` | FK → `accounts.id`, nullable | |
| `reblog_of_id`           | FK → `statuses.id`, nullable | set when this row represents a boost |
| `sensitive`              | Boolean | default `False` |
| `spoiler_text`           | String | default `""` |
| `visibility`              | String | one of `public`, `unlisted`, `private`, `direct` |
| `language`               | String, nullable | |
| `poll_id`                | FK → `polls.id`, nullable | |
| `url`                    | String, nullable | computed if NULL |
| `application_id`         | FK → `oauth_apps.id`, nullable | the app that posted it |

Reblogs are modeled as their **own row** with `reblog_of_id` pointing at the original
(matches Mastodon's `Status.reblog` being a nested `Status`). `reblogs_count` /
`favourites_count` / `replies_count` are computed via joins/counts, not stored.

### `status_mentions`

Maps to `StatusMention`. Many-to-many between statuses and mentioned accounts.

| column         | type | notes |
|-----------------|------|-------|
| `id`            | BigInteger PK | |
| `status_id`     | FK → `statuses.id` | |
| `account_id`    | FK → `accounts.id` | |

### `status_tags`

Hashtags attached to a status (for `Tag` serialization and `timeline_hashtag`).

| column      | type | notes |
|--------------|------|-------|
| `id`         | BigInteger PK | |
| `status_id`  | FK → `statuses.id` | |
| `name`       | String | lowercase, no leading `#` |

### `media_attachments`

Maps to `MediaAttachment`. Created by `media_post`, optionally attached to a status via
`status_attachments`.

| column            | type    | notes |
|--------------------|---------|-------|
| `id`               | BigInteger PK | |
| `account_id`       | FK → `accounts.id` | uploader |
| `status_id`        | FK → `statuses.id`, nullable | NULL until attached by `status_post` |
| `type`             | String | `image`, `video`, `gifv`, `audio`, `unknown` — inferred from mime type |
| `url`              | String | path under the mock's static file serving, or placeholder URL |
| `preview_url`      | String | same as `url` for v1 (no thumbnailing) |
| `description`      | Text, nullable | alt text |
| `blurhash`         | String, nullable | static placeholder string |
| `meta`             | JSON, nullable | `{}` unless caller passed `media_attributes`/focus |
| `created_at`       | DateTime | |

Uploaded bytes are written to a temp/config-configurable directory
(`config.media_storage_path`, default a `tempfile.mkdtemp()` per server instance) and
served back via a `/media/{id}/{filename}` static route so `url`/`preview_url` are
fetchable, real URLs (some client code may `requests.get()` the avatar/media URL — not
required, but cheap to support).

### `polls`

Maps to `Poll`.

| column          | type | notes |
|------------------|------|-------|
| `id`             | BigInteger PK | |
| `status_id`      | FK → `statuses.id`, nullable | NULL while being constructed via `status_post(poll=...)` before the status row exists — in practice create status+poll in same transaction, so this can be NOT NULL |
| `expires_at`     | DateTime, nullable | |
| `multiple`       | Boolean | default `False` |
| `hide_totals`    | Boolean | default `False` |

### `poll_options`

| column        | type | notes |
|----------------|------|-------|
| `id`           | BigInteger PK | |
| `poll_id`      | FK → `polls.id` | |
| `position`     | Integer | 0-based order |
| `title`        | String | |

### `poll_votes`

| column        | type | notes |
|----------------|------|-------|
| `id`           | BigInteger PK | |
| `poll_id`      | FK → `polls.id` | |
| `account_id`   | FK → `accounts.id` | |
| `option_position` | Integer | which option (by `poll_options.position`) |

`votes_count` per option and `voters_count` for the poll are derived via `GROUP BY`.

### `relationships`

The single table backing `account_follow`/`account_unfollow`/`account_block`/
`account_mute`/`account_relationships`/`follow_requests`/etc. One row per **directed
edge** `(source_account -> target_account)` with boolean flags, matching the shape of
the `Relationship` entity almost directly.

| column                  | type     | notes |
|--------------------------|----------|-------|
| `id`                     | BigInteger PK | |
| `source_account_id`      | FK → `accounts.id` | the "logged in user" side |
| `target_account_id`      | FK → `accounts.id` | |
| `following`             | Boolean | default `False` |
| `showing_reblogs`        | Boolean | default `True` |
| `notifying`              | Boolean | default `False` |
| `languages`              | JSON, nullable | |
| `followed_by`            | Boolean | default `False` — **kept in sync**: when A follows B, A's row toward B sets `following=True`, and B's row toward A (created if absent) sets `followed_by=True` |
| `blocking`               | Boolean | default `False` |
| `blocked_by`             | Boolean | mirrors a `blocking` row in the other direction |
| `muting`                 | Boolean | default `False` |
| `muting_notifications`   | Boolean | default `True` |
| `muting_expires_at`      | DateTime, nullable | |
| `domain_blocking`        | Boolean | default `False` — actually keyed by domain, see note below |
| `endorsed`               | Boolean | default `False` |
| `requested`              | Boolean | default `False` — pending outgoing follow request (locked target) |
| `requested_by`           | Boolean | default `False` — pending incoming follow request |
| `note`                   | Text | default `""` — private note (`account_note_set`) |

Unique constraint on `(source_account_id, target_account_id)`. A row is created
lazily (on first interaction) with all-default/false values, and `account_relationships`
returns a default/all-false `Relationship` for pairs that have no row at all (matches
real API behavior of always returning a relationship object, never 404).

**Locked accounts**: if `target.locked` is `True`, `account_follow` creates the edge
with `requested=True, following=False` instead of `following=True`, and a
corresponding row for the target gets `requested_by=True`. `follow_request_authorize`
flips `requested -> following` (and the mirror `requested_by -> followed_by`).
`follow_request_reject` deletes the pending edge.

**Domain blocks**: stored in a separate small table `domain_blocks` (see below) rather
than encoded per-relationship, since `domain_blocking` in `Relationship` is really
"is `target.domain` in `source`'s domain block list".

### `domain_blocks`

| column            | type | notes |
|--------------------|------|-------|
| `id`               | BigInteger PK | |
| `account_id`       | FK → `accounts.id` | the blocker (logged-in user) |
| `domain`           | String | |

### `favourites`

| column        | type | notes |
|----------------|------|-------|
| `id`           | BigInteger PK | |
| `account_id`   | FK → `accounts.id` | |
| `status_id`    | FK → `statuses.id` | |
| `created_at`   | DateTime | |

Unique `(account_id, status_id)`. `favourites_count` on a status = `COUNT(*)` here.
`status_favourite` / `status_unfavourite` insert/delete. `favourites()` lists a user's
favourited statuses ordered by `created_at` desc.

### `bookmarks`

Same shape as `favourites`, separate table (`account_id`, `status_id`, `created_at`),
backs `status_bookmark` / `status_unbookmark` / `bookmarks()`.

### `pins`

Same shape, backs `status_pin` / `status_unpin` and `account_statuses(pinned=True)`.
Also doubles for `account_pin`/`account_unpin`/`account_endorse` — actually endorsement
is `relationships.endorsed`, not this table; `pins` is statuses-only.

### `mutes` (status mutes, conversation mutes)

`status_mute`/`status_unmute` operate on a `conversation_mutes` table keyed by
`(account_id, status_id_root_of_conversation)` — but for v1, a simpler
`status_id`-keyed table is sufficient since Mastodon.py doesn't deeply validate
conversation semantics:

| column        | type | notes |
|----------------|------|-------|
| `id`           | BigInteger PK | |
| `account_id`   | FK → `accounts.id` | |
| `status_id`    | FK → `statuses.id` | |

### `notifications`

Maps to `Notification`. Generated as a **side effect** of write operations (see
[03-api-coverage.md](03-api-coverage.md) "Notification generation" section).

| column          | type | notes |
|------------------|------|-------|
| `id`             | BigInteger PK | |
| `account_id`     | FK → `accounts.id` | recipient (the notified user) |
| `type`           | String | `mention`, `reblog`, `favourite`, `follow`, `follow_request`, `poll`, `status` |
| `from_account_id`| FK → `accounts.id` | actor who triggered it |
| `status_id`      | FK → `statuses.id`, nullable | |
| `created_at`     | DateTime | |
| `read`           | Boolean | default `False` — for `notifications_unread_count` / dismiss |

### `user_lists`

Maps to `UserList`.

| column            | type | notes |
|--------------------|------|-------|
| `id`               | BigInteger PK | |
| `account_id`       | FK → `accounts.id` | owner |
| `title`            | String | |
| `replies_policy`   | String | default `"list"` |
| `exclusive`        | Boolean | default `False` |

### `user_list_accounts`

| column         | type | notes |
|-----------------|------|-------|
| `id`            | BigInteger PK | |
| `list_id`       | FK → `user_lists.id` | |
| `account_id`    | FK → `accounts.id` | |

### `filters` (v2)

Maps to `FilterV2` + `FilterKeyword`. v1 `Filter` (`filters()`/`filter_create`) can be
modeled with the same tables and a serializer that emits the v1 shape (`phrase`,
`context`, `irreversible`, `whole_word`, `expires_at` directly on the filter row).

| column            | type | notes |
|--------------------|------|-------|
| `id`               | BigInteger PK | |
| `account_id`       | FK → `accounts.id` | |
| `title`            | String | (v2) / `phrase` (v1, single keyword) |
| `context`          | JSON | list of strings: `home`, `notifications`, `public`, `thread`, `account` |
| `expires_at`       | DateTime, nullable | |
| `filter_action`    | String | `warn` or `hide` |

### `filter_keywords`

| column         | type | notes |
|-----------------|------|-------|
| `id`            | BigInteger PK | |
| `filter_id`     | FK → `filters.id` | |
| `keyword`       | String | |
| `whole_word`    | Boolean | default `True` |

### `scheduled_statuses`

| column          | type | notes |
|------------------|------|-------|
| `id`             | BigInteger PK | |
| `account_id`     | FK → `accounts.id` | |
| `scheduled_at`   | DateTime | |
| `params`         | JSON | the original `status_post` params (text, media_ids, visibility, ...) |

A background "publish" step is **not** time-driven (no real scheduler); instead,
`scheduled_statuses()` / `scheduled_status()` simply list rows whose `scheduled_at` is
in the future. If `scheduled_at <= now()`, the mock may lazily convert it to a real
`statuses` row on next read — or this conversion can be left as out-of-scope "Stub" per
[03-api-coverage.md](03-api-coverage.md), since Mastodon.py tests rarely depend on
scheduled-post publication actually happening.

### `markers`

Maps to `Marker` (`markers_get`/`markers_set`).

| column          | type | notes |
|------------------|------|-------|
| `id`             | BigInteger PK | |
| `account_id`     | FK → `accounts.id` | |
| `timeline`       | String | `home` or `notifications` |
| `last_read_id`   | BigInteger | |
| `version`        | Integer | incremented on each set |
| `updated_at`     | DateTime | |

Unique `(account_id, timeline)`.

## Entity-relationship summary

```
accounts ──┬─< statuses >── status_mentions ─> accounts
           ├─< media_attachments
           ├─< relationships (source) >─┐
           ├─< relationships (target) >─┘ (self-referential)
           ├─< favourites >── statuses
           ├─< bookmarks >── statuses
           ├─< pins >── statuses
           ├─< notifications (account_id, from_account_id) >─ accounts
           ├─< user_lists >─< user_list_accounts >─ accounts
           ├─< filters >─< filter_keywords
           ├─< domain_blocks
           ├─< oauth_tokens >── oauth_apps
           └─< markers

statuses ──┬─< status_tags
           ├─< poll (1:1)
           └─< status_mentions
```
