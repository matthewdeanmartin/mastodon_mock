# Version Awareness

## Why this matters

Mastodon.py gates many methods behind `@api_version(created_ver, last_changed_ver)`
(see [`mastodon/versions.py`](../Mastodon.py/mastodon/versions.py)). When
`version_check_mode != "none"`, calling a method whose `last_changed_ver` (or the
return type's `_version`, whichever is greater) exceeds the *detected* server version
raises `MastodonVersionError` **before any HTTP request is even made**.

Version detection (`retrieve_mastodon_version()`) works by:

1. `GET /api/v1/instance/` → read `["version"]` → `parse_version_string()` →
   `mastodon_major/minor/patch`.
1. `GET /api/v2/instance/` → read `["api_versions"]["mastodon"]` →
   `mastodon_api_version` (an integer, e.g. `2`). If `mastodon_major.minor >= 4.3` and
   this is absent, Mastodon.py emits a `UserWarning`.

So: **the mock's `/api/v1/instance` and `/api/v2/instance` responses directly control
which Mastodon.py methods a connected client believes it can call.**

## "Current and current-1", concretely

Rather than try to track Mastodon's release train forever, the mock pins **two**
version strings in its own config defaults, refreshed periodically as a maintenance
task (not automatically):

```toml
[tool.mastodon_mock]
mocked_version = "4.4.4"        # "current" — default
# mocked_version = "4.3.9"      # "current - 1" — set this to test against the older line
```

- `mocked_version` is a single value per running server instance — there is **one**
  `/api/v1/instance` response, reflecting whichever version the config says. A
  consuming test suite that wants to test "does my code work against both the latest
  and the previous stable Mastodon" runs the **mock twice** (two server instances /
  two pytest fixture parametrizations), once per `mocked_version`, NOT a single server
  that pretends to be two versions at once.

- `mastodon_api_version` (the `api_versions.mastodon` integer) is derived from
  `mocked_version` via a small lookup table in `mastodon_mock/versioning.py`:

  ```python
  # mastodon_mock/versioning.py
  API_VERSION_BY_MASTODON_VERSION = {
      (4, 4): 2,
      (4, 3): 2,
      (4, 2): 1,
      (4, 1): 1,
      (4, 0): 1,
  }

  def api_version_for(mocked_version: str) -> int:
      major, minor, _ = parse_version_string(mocked_version)
      return API_VERSION_BY_MASTODON_VERSION.get((major, minor), 2)
  ```

  (Values taken from Mastodon's own changelog notes about API versioning introduced in
  4.3; update the table when bumping `mocked_version` defaults.)

## What "current" and "current-1" mean in practice for this project

- **current** = the newest Mastodon release the project has validated the mock against
  (tracked in `mastodon_mock/versioning.py` as `CURRENT_VERSION`).
- **current-1** = the previous minor line (tracked as `PREVIOUS_VERSION`).
- These two constants are exported and used as the **default `mocked_version`** and as
  the two values exercised in the mock's own test matrix (`tests/test_versions.py`
  parametrizes over both).
- Mastodon.py itself only has ONE installed version at a time (whatever's in
  `pyproject.toml`'s dependency on `mastodon.py`), and its `return_types.py`
  `_version` markers go up to `4.6.0` as of the vendored copy in `Mastodon.py/`. The
  mock does **not** need to support `_version` markers newer than `CURRENT_VERSION` —
  if Mastodon.py's `@api_version` decorator would reject a call against
  `CURRENT_VERSION` anyway (because `version_check_mode != "none"`), the mock never
  sees that request, so there's nothing to implement.
- **Practical effect**: any endpoint whose `last_changed_ver`/`_version` is `> CURRENT_VERSION`
  is automatically unreachable from a correctly-configured Mastodon.py client in
  `version_check_mode="created"` or `"changed"` mode, and therefore doesn't need a
  route at all — though the mock implements the commonly-needed ones anyway for
  `version_check_mode="none"` (the default!) callers. **`version_check_mode` defaults
  to `"none"`**, so in practice Mastodon.py will call *any* method regardless of the
  mock's advertised version — the advertised version mostly matters for (a) tests that
  explicitly set `version_check_mode`, and (b) `verify_minimum_version()` calls inside
  Mastodon.py itself (e.g. `status_card()`'s internal branch, `instance()`'s v1/v2
  branch).

## `/api/v1/instance/` response shape (excerpt)

```json
{
  "uri": "mock.local",
  "title": "Mastodon Mock",
  "short_description": "A local mock Mastodon instance for testing.",
  "description": "A local mock Mastodon instance for testing.",
  "email": "admin@mock.local",
  "version": "4.4.4",
  "urls": {"streaming_api": "wss://mock.local"},
  "stats": {"user_count": 0, "status_count": 0, "domain_count": 1},
  "thumbnail": null,
  "languages": ["en"],
  "registrations": true,
  "approval_required": false,
  "invites_enabled": false,
  "configuration": {
    "statuses": {
      "max_characters": 500,
      "max_media_attachments": 4,
      "characters_reserved_per_url": 23
    },
    "media_attachments": {
      "supported_mime_types": ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4"],
      "image_size_limit": 10485760,
      "video_size_limit": 41943040
    },
    "polls": {
      "max_options": 4,
      "max_characters_per_option": 50,
      "min_expiration": 300,
      "max_expiration": 2629746
    }
  },
  "contact_account": null,
  "rules": []
}
```

`["stats"]["user_count"]`/`["status_count"]` are computed live from the DB (cheap
`COUNT(*)`), giving tests something real to assert on if desired.

## `/api/v2/instance/` response shape (excerpt)

Adds/renames per `InstanceV2`:

```json
{
  "domain": "mock.local",
  "title": "Mastodon Mock",
  "version": "4.4.4",
  "source_url": "https://github.com/matthewdeanmartin/mastodon_mock",
  "description": "A local mock Mastodon instance for testing.",
  "usage": {"users": {"active_month": 0}},
  "thumbnail": {"url": null},
  "languages": ["en"],
  "configuration": { "...": "same as v1.configuration, reshaped per InstanceConfigurationV2" },
  "registrations": {"enabled": true, "approval_required": false, "message": null},
  "contact": {"email": "admin@mock.local", "account": null},
  "rules": [],
  "icon": [],
  "api_versions": {"mastodon": 2}
}
```

## `instance_nodeinfo()`

`GET /.well-known/nodeinfo` → `{"links": [{"rel": "...2.0", "href": ".../nodeinfo/2.0"}]}`
→ `GET /nodeinfo/2.0`:

```json
{
  "version": "2.0",
  "software": {"name": "mastodon_mock", "version": "4.4.4"},
  "protocols": ["activitypub"],
  "usage": {"users": {"total": 0}, "localPosts": 0},
  "openRegistrations": true
}
```

`software.version` is set to `mocked_version` so anything that branches on
nodeinfo-reported version sees the same value as `/api/v1/instance`.

## Testing both versions

```python
# tests/conftest.py (in the *consuming* project)
import pytest

@pytest.fixture(params=["4.4.4", "4.3.9"])
def mock_server(request, tmp_path):
    config = MastodonMockConfig(mocked_version=request.param, database=DatabaseConfig(path=":memory:"), ...)
    # spin up app with this config, yield base_url
```

The mock project's own `tests/` does the equivalent, parametrizing
`mastodon_mock.versioning.CURRENT_VERSION` / `PREVIOUS_VERSION` to make sure the
instance-info routes and any version-conditional logic (there is currently none beyond
the reported strings) behave for both.

## Bumping `CURRENT_VERSION` / `PREVIOUS_VERSION`

This is a **manual maintenance task**, not automatic:

1. Check the latest Mastodon stable release.
1. Update `CURRENT_VERSION` (and shift the old `CURRENT_VERSION` into
   `PREVIOUS_VERSION`) in `mastodon_mock/versioning.py`.
1. Update `API_VERSION_BY_MASTODON_VERSION` if a new minor line is added.
1. Re-run `tests/test_versions.py` and the consuming project's dual suite.
1. Note the bump in `CHANGELOG.md`.

No CI job auto-bumps this — Mastodon's release cadence is slow enough that a manual
quarterly check is sufficient, and auto-bumping risks silently breaking the "current-1"
contract if a new major version ships.
