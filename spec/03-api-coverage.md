# API Coverage Matrix

> **Implementation status:** all **Full**, **Static**, and **Stub** rows
> below are implemented and exercised by Mastodon.py-driven contract tests in
> `tests/test_contract_core.py`, `tests/test_contract_extended.py`, and (for the
> admin API) `tests/test_contract_admin.py`. **OOS** rows are deliberately not
> routed (Mastodon.py gets a 404). The routers live in `mastodon_mock/routers/`
> mirroring this document's section headings. The admin / moderation API
> (`routers/admin.py`) is **in scope** as of the admin phase — see that section
> below.

Legend (see [00-overview.md](00-overview.md) for definitions):

- **Full** — real state, persisted, reflected in subsequent reads.
- **Static** — fixed-shape response, no persistence.
- **Stub** — empty list / `None` / minimal valid shape so Mastodon.py doesn't error.
- **OOS** — out of scope; route not implemented (Mastodon.py raises
  `MastodonNotFoundError`/`MastodonAPIError` on 404, which is acceptable since these are
  endpoints a consuming test suite shouldn't be calling anyway).

Each row lists the Mastodon.py method(s) that hit the route, so gaps can be traced back
to a concrete client call.

## `routers/oauth.py` — apps & auth

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| POST | `/api/v1/apps` | `Mastodon.create_app()` (staticmethod, no instance) | **Full** — creates `oauth_apps` row, returns `client_id`/`client_secret` |
| POST | `/oauth/token` | `log_in()`, `create_account()` (client_credentials step) | **Full** — see [04-auth.md](04-auth.md) |
| POST | `/oauth/revoke` | `revoke_access_token()` | **Full** — deletes `oauth_tokens` row |
| GET | `/.well-known/oauth-authorization-server` | `oauth_authorization_server_info()`, called internally by `log_in()` | **Static** — fixed `OAuthServerInfo` JSON pointing back at `/oauth/token`, `/oauth/revoke`, advertising `authorization_code` + `client_credentials` (NOT `password`, matching 4.4+) |
| GET | `/oauth/userinfo` | `oauth_userinfo()` | **Static** — minimal OIDC-ish claims derived from the authed account |
| GET | `/api/v1/apps/verify_credentials` | `app_verify_credentials()` | **Full** — looks up `oauth_apps` row for the bearer token's app |
| POST | `/api/v1/accounts` | `create_account()` | **Full** — see [04-auth.md](04-auth.md) "self-service signup" |
| POST | `/api/v1/emails/confirmations` | `email_resend_confirmation()` | **Stub** — 200 + empty body |

## `routers/instance.py` — instance metadata

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/instance/` | `instance_v1()`, `instance()` fallback | **Static** — built from config (`mocked_version`, `domain`, `title`); `configuration.statuses.max_characters` etc. set to real Mastodon defaults |
| GET | `/api/v2/instance/` | `instance_v2()`, `instance()` | **Static** — same data reshaped to `InstanceV2`, includes `api_versions` (see [05-versioning.md](05-versioning.md)) |
| GET | `/api/v1/instance/activity` | `instance_activity()` | **Full** — 12 weeks of `{week, statuses, logins, registrations}` (string values) counted from local statuses/accounts |
| GET | `/api/v1/instance/peers` | `instance_peers()` | **Full** — distinct domains of "remote" accounts |
| GET | `/.well-known/nodeinfo` + nodeinfo doc | `instance_nodeinfo()` | **Static** — minimal 2.0 schema doc with `software.name="mastodon_mock"`, `software.version=mocked_version` |
| GET | `/api/v1/instance/rules` | `instance_rules()` | **Static** — empty list by default, configurable via seed config |
| GET | `/api/v1/instance/terms_of_service` | `instance_terms_of_service()` | **Stub** — `MastodonNotFoundError` (404) — matches instances with no ToS configured |
| GET | `/api/v1/directory` | `instance_directory()` | **Full** — `order=active` (default) sorts by most recent status time, `order=new` by account `created_at`; `local` filters to local accounts |
| GET | `/api/v1/custom_emojis` | `custom_emojis()` | **Static** — small fixed set in the `CustomEmoji` shape |
| GET | `/api/v1/announcements` | `announcements()` | **Stub** — empty list (matches an instance with none configured) |
| POST | `/api/v1/announcements/{id}/dismiss` | `announcement_dismiss()` | **OOS** (no announcements exist to dismiss) |
| PUT/DELETE | `/api/v1/announcements/{id}/reactions/{reaction}` | `announcement_add_reaction()` / `announcement_remove_reaction()` | **OOS** |
| GET | `/api/v1/instance/extended_description` | `instance_extended_description()` | **Static** — empty/placeholder HTML |
| GET | `/api/v1/instance/translation_languages` | `instance_supported_translation_languages()` | **Static** — each supported source language → fixed target set (`{source: [targets...]}`) |
| GET | `/api/v1/instance/domain_blocks` | `instance_domain_blocks()` | **Full** — derived from admin domain blocks; each entry has a sha256 `digest`, `severity`, `comment` |
| GET | `/api/v1/instance/languages` | `instance_languages()` | **Static** — `["en"]` |

## `routers/accounts.py` — accounts (read)

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/accounts/{id}` | `account()` | **Full** |
| GET | `/api/v1/accounts` (`id[]=`) | `accounts()` | **Full** |
| GET | `/api/v1/accounts/verify_credentials` | `account_verify_credentials()`, `me()` | **Full** — resolves bearer token → account, includes `source` block |
| GET | `/api/v1/accounts/{id}/statuses` | `account_statuses()` | **Full** — filters: `only_media`, `pinned`, `exclude_replies`, `exclude_reblogs`, `tagged`, pagination |
| GET | `/api/v1/accounts/{id}/following` | `account_following()` | **Full** |
| GET | `/api/v1/accounts/{id}/followers` | `account_followers()` | **Full** |
| GET | `/api/v1/accounts/relationships` | `account_relationships()` | **Full** |
| GET | `/api/v1/accounts/search` | `account_search()`, `follows()` (legacy) | **Full** — substring match on `username`/`display_name`/`acct` over seeded accounts |
| GET | `/api/v1/accounts/{id}/lists` | `account_lists()` | **Full** |
| GET | `/api/v1/accounts/lookup` | `account_lookup()` | **Full** — exact `acct` match |
| GET | `/api/v1/accounts/familiar_followers` | `account_familiar_followers()` | **Full** — intersection of followers |
| GET | `/api/v1/accounts/{id}/featured_tags` | `account_featured_tags()` | **Full** — the account's featured tags (`FeaturedTag` shape; usage counts derived) |
| GET | `/api/v1/featured_tags` | `featured_tags()` | **Full** — the logged-in user's featured tags (see routers/tags.py) |

## `routers/accounts.py` — accounts (write) — **high priority**

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| POST | `/api/v1/accounts/{id}/follow` | `account_follow()`, `follows()` | **Full** — creates/updates `relationships` row(s); generates `follow`/`follow_request` notification (see "Notification generation" below) |
| POST | `/api/v1/accounts/{id}/unfollow` | `account_unfollow()` | **Full** |
| POST | `/api/v1/accounts/{id}/remove_from_followers` | `account_remove_from_followers()` | **Full** — clears the other side's `following`/`followed_by` |
| POST | `/api/v1/accounts/{id}/block` | `account_block()` | **Full** — also clears any follow edges between the two accounts |
| POST | `/api/v1/accounts/{id}/unblock` | `account_unblock()` | **Full** |
| POST | `/api/v1/accounts/{id}/mute` | `account_mute()` | **Full** — supports `notifications`, `duration` → `muting_expires_at` |
| POST | `/api/v1/accounts/{id}/unmute` | `account_unmute()` | **Full** |
| PATCH | `/api/v1/accounts/update_credentials` | `account_update_credentials()` | **Full** — updates `accounts` row fields incl. `fields`, `source.*`; `avatar`/`header` file upload accepted and stored, URL updated |
| POST | `/api/v1/accounts/{id}/pin` | `account_pin()` (deprecated alias) | **Full** — sets `relationships.endorsed=True` |
| POST | `/api/v1/accounts/{id}/unpin` | `account_unpin()` | **Full** |
| POST | `/api/v1/accounts/{id}/endorse` | `account_endorse()` | **Full** (same as pin) |
| POST | `/api/v1/accounts/{id}/unendorse` | `account_unendorse()` | **Full** |
| POST | `/api/v1/accounts/{id}/note` | `account_note_set()` | **Full** — sets `relationships.note` |
| DELETE | `/api/v1/profile/avatar` | `account_delete_avatar()` | **Full** — clears `avatar_url` |
| DELETE | `/api/v1/profile/header` | `account_delete_header()` | **Full** — clears `header_url` |

## `routers/relationships.py` — mutes/blocks/follow requests/domain blocks

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/mutes` | `mutes()` | **Full** |
| GET | `/api/v1/blocks` | `blocks()` | **Full** |
| GET | `/api/v1/follow_requests` | `follow_requests()` | **Full** — accounts with `requested_by=True` toward the logged-in user |
| POST | `/api/v1/follow_requests/{id}/authorize` | `follow_request_authorize()` | **Full** |
| POST | `/api/v1/follow_requests/{id}/reject` | `follow_request_reject()` | **Full** |
| GET | `/api/v1/domain_blocks` | `domain_blocks()` | **Full** |
| POST | `/api/v1/domain_blocks` | `domain_block()` | **Full** |
| DELETE | `/api/v1/domain_blocks` | `domain_unblock()` | **Full** |

## `routers/statuses.py` — statuses (read)

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/statuses/{id}` | `status()` | **Full** |
| GET | `/api/v1/statuses` (`id[]=`) | `statuses()` | **Full** |
| GET | `/api/v1/statuses/{id}/context` | `status_context()` | **Full** — walks `in_reply_to_id` chain for ancestors; children for descendants |
| GET | `/api/v1/statuses/{id}/reblogged_by` | `status_reblogged_by()` | **Full** |
| GET | `/api/v1/statuses/{id}/favourited_by` | `status_favourited_by()` | **Full** |
| GET | `/api/v1/statuses/{id}/card` | `status_card()` (pre-3.0 fallback) | **Stub** — `status.card` is always `None`/absent; `status_card` on a 4.x mock will use the `Status.card` field path instead and this route is unused |
| GET | `/api/v1/statuses/{id}/history` | `status_history()` | **Full** — one entry per edit, see "Edits" below |
| GET | `/api/v1/statuses/{id}/source` | `status_source()` | **Full** |
| GET | `/api/v1/statuses/{id}/quotes` | `status_quotes()` | **Full** — paginated list of statuses quoting this one (4.5+). Quote posts via `quoted_status_id`; serializer emits `quote = {state: "accepted", quoted_status}`. |

## `routers/statuses.py` — statuses (write) — **highest priority**

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| POST | `/api/v1/statuses` | `status_post()`, `toot()`, `status_reply()` | **Full** — creates `statuses` row; parses `@mentions` from text into `status_mentions`; parses `#hashtags` into `status_tags`; honors `in_reply_to_id`, `visibility`, `sensitive`, `spoiler_text`, `language`, `media_ids` (attaches existing `media_attachments`), `poll` (creates `polls`+`poll_options`), `quoted_status_id`/`quote_id` (sets `statuses.quoted_status_id` if it resolves; emitted as `quote`), `scheduled_at` (creates a `scheduled_statuses` row and returns `ScheduledStatus` only when ≥ ~5 min out, otherwise publishes immediately; due rows publish lazily on list read). Generates `mention` notifications for each mentioned account. `idempotency_key` honored via an in-memory/db dedup table keyed by `(account_id, idempotency_key)` within a short TTL. |
| PUT | `/api/v1/statuses/{id}` | `status_update()` | **Full** — updates `content`/`text`/`spoiler_text`/`sensitive`/`media_ids`/poll; appends a `StatusEdit` snapshot to history; sets `edited_at` |
| DELETE | `/api/v1/statuses/{id}` | `status_delete()` | **Full** — deletes row (or soft-delete flag); returns deleted status shape with `text` set. `delete_media=True` also deletes attached `media_attachments` |
| POST | `/api/v1/statuses/{id}/reblog` | `status_reblog()` | **Full** — creates a new `statuses` row with `reblog_of_id` set; generates `reblog` notification for original author |
| POST | `/api/v1/statuses/{id}/unreblog` | `status_unreblog()` | **Full** — deletes the reblog row owned by the logged-in user |
| POST | `/api/v1/statuses/{id}/favourite` | `status_favourite()` | **Full** — inserts `favourites` row; generates `favourite` notification |
| POST | `/api/v1/statuses/{id}/unfavourite` | `status_unfavourite()` | **Full** |
| POST | `/api/v1/statuses/{id}/mute` | `status_mute()` | **Full** — inserts `mutes` row |
| POST | `/api/v1/statuses/{id}/unmute` | `status_unmute()` | **Full** |
| POST | `/api/v1/statuses/{id}/pin` | `status_pin()` | **Full** — inserts `pins` row (only allowed for own statuses, mirroring real API's 422 otherwise — but mock can be lenient) |
| POST | `/api/v1/statuses/{id}/unpin` | `status_unpin()` | **Full** |
| POST | `/api/v1/statuses/{id}/bookmark` | `status_bookmark()` | **Full** |
| POST | `/api/v1/statuses/{id}/unbookmark` | `status_unbookmark()` | **Full** |
| POST | `/api/v1/statuses/{id}/translate` | `status_translate()` | **Static** — returns the original `content` verbatim with `detected_source_language="en"`, `provider="mastodon_mock"` (good enough for callers that just check the shape) |
| POST | `/api/v1/statuses/{id}/quotes/{qid}/revoke` | `status_quote_revoke()` | **Full** — sets the quoting status's `quote.state` to `revoked` (which hides `quoted_status`); only the quoted status's author may revoke |
| PUT | `/api/v1/statuses/{id}/interaction_policy` | `status_update_quote_approval_policy()` | **Full** — sets `quote_approval_policy` (`public`/`followers`/`nobody`); `private`/`direct` statuses are forced to `nobody`; author-only |

### Scheduled statuses

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/scheduled_statuses` | `scheduled_statuses()` | **Full** |
| GET | `/api/v1/scheduled_statuses/{id}` | `scheduled_status()` | **Full** |
| PUT | `/api/v1/scheduled_statuses/{id}` | `scheduled_status_update()` | **Full** |
| DELETE | `/api/v1/scheduled_statuses/{id}` | `scheduled_status_delete()` | **Full** |

## `routers/timelines.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/timelines/home` | `timeline()`/`timeline_home()` | **Full** — statuses from accounts the logged-in user follows + own statuses, ordered by `created_at` desc, `max_id`/`min_id`/`since_id`/`limit` paging |
| GET | `/api/v1/timelines/public` | `timeline()`/`timeline_public()`/`timeline_local()` (via `local=True`) | **Full** — all `public`/`unlisted` statuses; `local=True` filters to accounts with `domain IS NULL`; `remote=True` filters to `domain IS NOT NULL` |
| GET | `/api/v1/timelines/tag/{hashtag}` | `timeline_hashtag()` | **Full** — join through `status_tags` |
| GET | `/api/v1/timelines/list/{id}` | `timeline_list()` | **Full** — statuses from accounts in the given `user_lists` |
| GET | `/api/v1/timelines/link` | `timeline_link()` | **Stub** — empty list (trending-links timeline; low priority) |

## `routers/notifications.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/notifications` | `notifications()` | **Full** — filterable by `types`/`exclude_types`/`account_id` |
| GET | `/api/v1/notifications/{id}` | `notifications(id=...)` | **Full** |
| GET | `/api/v1/notifications/unread_count` | `notifications_unread_count()` | **Full** |
| POST | `/api/v1/notifications/clear` | `notifications_clear()` | **Full** — deletes all notifications for the user |
| POST | `/api/v1/notifications/{id}/dismiss` (and bulk variant) | `notifications_dismiss()` | **Full** — sets `read=True` / deletes |
| GET/PATCH | `/api/v2/notifications/policy` | `notifications_policy()`, `update_notifications_policy()` | **Static** — fixed "accept everything" policy (incl. `for_bots`); PATCH accepted and ignored |
| `/api/v1/notifications/requests*` | `notification_request*()` | **Full(ish)** — list is always empty (policy filters nothing); `requests/merged` returns `{merged: true}`; single fetch 404s; accept/dismiss (single + bulk) are no-ops |
| GET | `/api/v2/notifications` | `grouped_notifications()` | **Full** — groups favourite/follow/reblog by target into `NotificationGroup`s; other types stay individual. Returns the `accounts`/`statuses`/`notification_groups` container with `Link` pagination. |
| GET | `/api/v2/notifications/unread_count` | `unread_grouped_notifications_count()` | **Full** — counts unread *groups*, not rows |
| GET | `/api/v2/notifications/{group_key}` | `grouped_notification()` | **Full** — single-group container; 404 if no members |
| POST | `/api/v2/notifications/{group_key}/dismiss` | `dismiss_grouped_notification()` | **Full** — deletes every notification in the group |
| GET | `/api/v2/notifications/{group_key}/accounts` | `grouped_notification_accounts()` | **Full** — distinct actor accounts, newest first |

## `routers/media.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/media/{id}` | `media()` | **Full** |
| POST | `/api/v2/media` (and `/api/v1/media` fallback) | `media_post()` | **Full** — stores uploaded bytes under `media_storage_path`, infers `type` from mime, generates placeholder `blurhash`, returns `MediaAttachment` with `status_id=None` |
| PUT | `/api/v1/media/{id}` | `media_update()` | **Full** — updates `description`/`focus`/`thumbnail` metadata |

Uploaded media bytes are served back at `/media/{id}/{filename}` (a `StaticFiles`-style
route) so `url`/`preview_url` resolve to a working local URL.

## `routers/search.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/search` | `search()`/`search_v1()` | **Full** — searches `accounts.display_name`/`username`, `statuses.content` (substring), `status_tags.name` (for `#tag` queries) |
| GET | `/api/v2/search` | `search()`/`search_v2()` | **Full** — same, returns `SearchV2` shape (`accounts`/`statuses`/`hashtags`) |

No remote-resolve (`resolve=True` webfinger) — always behaves as `resolve=False`
(local-only search), consistent with the no-federation non-goal.

## `routers/lists.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/lists` | `lists()` | **Full** |
| GET | `/api/v1/lists/{id}` | `list()` | **Full** |
| GET | `/api/v1/lists/{id}/accounts` | `list_accounts()` | **Full** |
| POST | `/api/v1/lists` | `list_create()` | **Full** |
| PUT | `/api/v1/lists/{id}` | `list_update()` | **Full** |
| DELETE | `/api/v1/lists/{id}` | `list_delete()` | **Full** |
| POST | `/api/v1/lists/{id}/accounts` | `list_accounts_add()` | **Full** |
| DELETE | `/api/v1/lists/{id}/accounts` | `list_accounts_delete()` | **Full** |

## `routers/favourites_bookmarks.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/favourites` | `favourites()` | **Full** |
| GET | `/api/v1/bookmarks` | `bookmarks()` | **Full** |

## `routers/filters.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/filters` | `filters()` | **Full** — v1 shape derived from `filters`+`filter_keywords` (single keyword per filter) |
| GET | `/api/v1/filters/{id}` | `filter()` | **Full** |
| POST | `/api/v1/filters` | `filter_create()` | **Full** |
| PUT | `/api/v1/filters/{id}` | `filter_update()` | **Full** |
| DELETE | `/api/v1/filters/{id}` | `filter_delete()` | **Full** |
| GET | `/api/v2/filters` | `filters_v2()` | **Full** |
| GET | `/api/v2/filters/{id}` | `filter_v2()` | **Full** |
| POST | `/api/v2/filters` | `create_filter_v2()` | **Full** |
| PUT | `/api/v2/filters/{id}` | `update_filter_v2()` | **Full** |
| DELETE | `/api/v2/filters/{id}` | `delete_filter_v2()` | **Full** |
| GET | `/api/v2/filters/{id}/keywords` | `filter_keywords_v2()` | **Full** |
| POST | `/api/v2/filters/{id}/keywords` | `add_filter_keyword_v2()` | **Full** |
| DELETE | `/api/v2/filters/keywords/{id}` | `delete_filter_keyword_v2()` | **Full** |
| GET | `/api/v2/filters/{id}/statuses` | `filter_statuses_v2()` | **Stub** — empty list |
| POST | `/api/v2/filters/{id}/statuses` | `add_filter_status_v2()` | **OOS** |
| GET/DELETE | `/api/v2/filters/statuses/{id}` | `filter_status_v2()`/`delete_filter_status_v2()` | **OOS** |

`filters_apply()` is a pure client-side helper (no HTTP call) — nothing to implement.

## `routers/conversations.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/conversations/` | `conversations()` | **Full** — derived from `direct`-visibility statuses grouped by participant set |
| POST | `/api/v1/conversations/{id}/read` | `conversations_read()` | **Full** |

## `routers/preferences.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/preferences` | `preferences()` | **Full** — derived from the account's `default_*` columns |
| GET | `/api/v1/markers` | `markers_get()` | **Full** |
| POST | `/api/v1/markers` | `markers_set()` | **Full** |

## `routers/polls.py`

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/polls/{id}` | `poll()` | **Full** |
| POST | `/api/v1/polls/{id}/votes` | `poll_vote()` | **Full** — inserts `poll_votes`; recomputes `votes_count`/`voters_count`/`own_votes` |

`make_poll()` is a pure client-side helper.

## `routers/admin.py` — admin / moderation API — **in scope**

> The admin API (`mastodon/admin.py`) is **in scope** as of this phase. Auth is
> faked like the rest of the mock: any authenticated account may call these
> endpoints — there is **no role/scope enforcement** (consistent with the "no real
> security" non-goal in [00-overview.md](00-overview.md)). Accounts carry
> moderation columns (`email`, `ip`, `role`, `confirmed`, `approved`, `disabled`,
> `silenced`, `suspended`, `sensitized`, `locale`, `invite_request`) backing the
> `AdminAccount` entity. Exercised by `tests/test_contract_admin.py`.

### Accounts

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v2/admin/accounts` | `admin_accounts_v2()` | **Full** — filters `origin` (default `local`), `by_domain`, `username`, `display_name`, `email`, `ip`, `permissions=staff`, `status`; paginated |
| GET | `/api/v1/admin/accounts` | `admin_accounts()` / `admin_accounts_v1()` | **Full** — v1 boolean-flag form (`remote`, `active`/`pending`/`disabled`/`silenced`/`suspended`, `staff`). NB: Mastodon.py types v1 as returning a single `AdminAccount`, so list elements arrive as raw dicts |
| GET | `/api/v1/admin/accounts/{id}` | `admin_account()` | **Full** |
| POST | `/api/v1/admin/accounts/{id}/enable` | `admin_account_enable()` | **Full** — clears `disabled` |
| POST | `/api/v1/admin/accounts/{id}/approve` | `admin_account_approve()` | **Full** — sets `approved` |
| POST | `/api/v1/admin/accounts/{id}/reject` | `admin_account_reject()` | **Full** — deletes account, returns its shape |
| POST | `/api/v1/admin/accounts/{id}/unsilence` | `admin_account_unsilence()` | **Full** |
| POST | `/api/v1/admin/accounts/{id}/unsuspend` | `admin_account_unsuspend()` | **Full** |
| POST | `/api/v1/admin/accounts/{id}/unsensitive` | `admin_account_unsensitive()` | **Full** |
| DELETE | `/api/v1/admin/accounts/{id}` | `admin_account_delete()` | **Full** |
| POST | `/api/v1/admin/accounts/{id}/action` | `admin_account_moderate()` | **Full** — `type` ∈ {disable, silence, suspend, sensitive, none}; `report_id` closes the report |

### Reports

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| POST | `/api/v1/reports` | `report()` | **Full** — creates a `reports` row (this is what populates the admin queue); returns the consumer-facing `Report` |
| GET | `/api/v1/admin/reports` | `admin_reports()` | **Full** — `resolved` toggles resolved/unresolved queue; `account_id`/`target_account_id` filters; paginated |
| GET | `/api/v1/admin/reports/{id}` | `admin_report()` | **Full** |
| POST | `/api/v1/admin/reports/{id}/assign_to_self` | `admin_report_assign()` | **Full** |
| POST | `/api/v1/admin/reports/{id}/unassign` | `admin_report_unassign()` | **Full** |
| POST | `/api/v1/admin/reports/{id}/reopen` | `admin_report_reopen()` | **Full** |
| POST | `/api/v1/admin/reports/{id}/resolve` | `admin_report_resolve()` | **Full** |

### Domain blocks / allows / email & IP blocks

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/admin/domain_blocks[/{id}]` | `admin_domain_blocks()` | **Full** |
| POST | `/api/v1/admin/domain_blocks` | `admin_create_domain_block()` | **Full** — `severity`, `reject_media`, `reject_reports`, comments, `obfuscate` |
| PUT | `/api/v1/admin/domain_blocks/{id}` | `admin_update_domain_block()` | **Full** |
| DELETE | `/api/v1/admin/domain_blocks/{id}` | `admin_delete_domain_block()` | **Full** |
| GET | `/api/v1/admin/domain_allows[/{id}]` | `admin_domain_allows()` / `admin_domain_allow()` | **Full** |
| POST | `/api/v1/admin/domain_allows` | `admin_create_domain_allow()` | **Full** — idempotent on `domain` |
| DELETE | `/api/v1/admin/domain_allows/{id}` | `admin_delete_domain_allow()` | **Full** |
| GET | `/api/v1/admin/email_domain_blocks[/{id}]` | `admin_email_domain_blocks()` / `admin_email_domain_block()` | **Full** |
| POST | `/api/v1/admin/email_domain_blocks` | `admin_create_email_domain_block()` | **Full** |
| DELETE | `/api/v1/admin/email_domain_blocks/{id}` | `admin_delete_email_domain_block()` | **Full** |
| GET | `/api/v1/admin/canonical_email_blocks[/{id}]` | `admin_canonical_email_blocks()` / `admin_canonical_email_block()` | **Full** |
| POST | `/api/v1/admin/canonical_email_blocks/test` | `admin_test_canonical_email_block()` | **Full** — canonicalizes (lowercase, strip dots + `+suffix`) then SHA256-matches |
| POST | `/api/v1/admin/canonical_email_blocks` | `admin_create_canonical_email_block()` | **Full** — by `email` or `canonical_email_hash` |
| DELETE | `/api/v1/admin/canonical_email_blocks/{id}` | `admin_delete_canonical_email_block()` | **Full** |
| GET | `/api/v1/admin/ip_blocks[/{id}]` | `admin_ip_blocks()` / `admin_ip_block()` | **Full** |
| POST | `/api/v1/admin/ip_blocks` | `admin_create_ip_block()` | **Full** — `severity`, `comment`, `expires_in` → `expires_at` |
| PUT | `/api/v1/admin/ip_blocks/{id}` | `admin_update_ip_block()` | **Full** |
| DELETE | `/api/v1/admin/ip_blocks/{id}` | `admin_delete_ip_block()` | **Full** |

### Trends & statistics

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/admin/trends/tags` | `admin_trending_tags()` | **Stub** — empty list (trends are Stub instance-wide) |
| GET | `/api/v1/admin/trends/statuses` | `admin_trending_statuses()` | **Stub** — empty list |
| GET | `/api/v1/admin/trends/links` | `admin_trending_links()` | **Stub** — empty list |
| POST | `/api/v1/admin/trends/{links,statuses,tags}/{id}/{approve,reject}` | `admin_approve_*` / `admin_reject_*` | **Static** — echo a minimal entity of the right shape |
| POST | `/api/v1/admin/measures` | `admin_measures()` | **Static** — one zero-valued `AdminMeasure` per requested key (no real aggregation) |
| POST | `/api/v1/admin/dimensions` | `admin_dimensions()` | **Static** — one empty `AdminDimension` per requested key |
| POST | `/api/v1/admin/retention` | `admin_retention()` | **Static** — empty cohort list |

## Modules entirely **out of scope** for v1

| Module | Reason |
|--------|--------|
| `mastodon/push.py` | WebPush/VAPID — irrelevant to write-then-read goal |
| `mastodon/streaming.py`, `streaming_endpoints.py` | Streaming/WebSocket — OOS for v1 |

Hashtag follow + fetch live in `routers/tags.py` and are now **Full** (backed by a
`followed_tags` table):

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/tags/{hashtag}` | `tag()` | **Full** — viewer-relative `following`/`featuring`, 7-day usage history |
| POST | `/api/v1/tags/{hashtag}/follow` | `tag_follow()` | **Full** — idempotent; persists a `followed_tags` row |
| POST | `/api/v1/tags/{hashtag}/unfollow` | `tag_unfollow()` | **Full** — idempotent |
| POST | `/api/v1/featured_tags` | `featured_tag_create()` | **Full** — features a tag (persists a `featured_tags` row); returns `FeaturedTag` |
| DELETE | `/api/v1/featured_tags/{id}` | `featured_tag_delete()` | **Full** — by row id; owner-only |
| GET | `/api/v1/featured_tags/suggestions` | `featured_tag_suggestions()` | **Full** — the user's 10 most-used, not-yet-featured tags |
| POST | `/api/v1/tags/{hashtag}/feature` | `tag_feature()` | **Full** — newer alias of create; idempotent; returns `Tag` with `featuring=True` |
| POST | `/api/v1/tags/{hashtag}/unfeature` | `tag_unfeature()` | **Full** — newer alias of delete; idempotent |

### Discovery surfaces (now data-derived, was Stub)

These were originally Stub/empty; they now return realistic, correctly-shaped content
derived from the mock's own local data (shapes captured from a live `mastodon.social`).
They do not reproduce Mastodon's ranking algorithms, but satisfy callers that iterate them.

| Method | Path | Mastodon.py caller(s) | Coverage |
|--------|------|------------------------|----------|
| GET | `/api/v1/suggestions`, `/api/v2/suggestions` | `suggestions()` / `suggestions_v2()` | **Full** — local accounts the viewer doesn't follow (emitted in the v2 `Suggestion` shape) |
| GET | `/api/v1/trends`, `/api/v1/trends/tags` | `trending_tags()` | **Full** — local hashtags ranked by status count, `Tag` shape with 7-day history |
| GET | `/api/v1/trends/statuses` | `trending_statuses()` | **Full** — public local statuses ranked by favourites |
| GET | `/api/v1/trends/links` | `trending_links()` | **Stub** — empty list (no preview-card synthesis) |
| GET | `/api/v1/endorsements` | `endorsements()` | **Full** — accounts with `relationships.endorsed=True` |
| GET | `/api/v1/followed_tags` | `followed_tags()` | **Full** — hashtags the viewer follows (backed by the `followed_tags` table; see routers/tags.py) |

## Notification generation (cross-cutting)

Several write endpoints have a side effect of inserting a row into `notifications`
for some *other* account:

| Trigger | Recipient | `type` |
|---------|-----------|--------|
| `status_post` with `@mention` | each mentioned account | `mention` |
| `status_reblog` | original status's author | `reblog` |
| `status_favourite` | status's author | `favourite` |
| `account_follow` (not locked) | followed account | `follow` |
| `account_follow` (locked target) | followed account | `follow_request` |
| `poll_vote` on own poll reaching... | poll's status author, when poll `expired` (mock: N/A, no time-based expiry) | `poll` *(low priority — only fires if/when a poll is marked expired via `status_update` or admin action; may be left unimplemented)* |

A self-action (e.g. favouriting your own post) does **not** generate a notification,
matching real Mastodon behavior.

## Status edits ("history")

`status_update()` (PUT `/api/v1/statuses/{id}`) appends a `StatusEdit` record (computed,
not necessarily its own table — can be derived by snapshotting `(content, spoiler_text,
sensitive, media_attachments, poll, created_at=edited_at-ish)` into a JSON column
`statuses.edit_history: JSON` = `list[dict]`). `status_history()` returns
`edit_history + [current state]` per the "N edits → N+1 history entries" rule in the
Mastodon.py docstring.

## Pagination

Mastodon.py's `PaginatableList` relies on a `Link` response header
(`<url>; rel="next", <url>; rel="prev"`) for `.next()`/`.previous()` and for
`max_id`/`min_id`/`since_id` based pagination. The mock's list endpoints:

1. Accept `max_id`, `min_id`, `since_id`, `limit` query params where the corresponding
   Mastodon.py method accepts them.
2. Apply them as `id <`/`id >`/`id >` filters + `ORDER BY id DESC` + `LIMIT`.
3. Set the `Link` header to `<self_url with max_id=<last id>>; rel="next"` (and `rel="prev"`
   with `min_id=<first id>`) when the result is non-empty and could plausibly have more
   pages — i.e. when `len(results) == limit` (or the configured default limit).
4. A shared helper `mastodon_mock/pagination.py` (`paginate(query, max_id, min_id,
   since_id, limit, default_limit=20) -> tuple[list[Row], LinkHeaderInfo]`) implements
   this once and is reused by every list endpoint.
