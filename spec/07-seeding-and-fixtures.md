# Seeding & Fixtures

## Goals

- Let a consuming test suite declare a small "world" of accounts, follows, and
  optionally pre-existing statuses, in config (TOML), so each test run starts from a
  known, multi-account state.
- Keep it **idempotent**: re-applying the same seed config to an already-seeded DB
  (e.g. a file-backed DB reused across local dev runs) should not create duplicates.
- Keep it **minimal**: most tests create their own statuses/follows at runtime via
  Mastodon.py calls (that's the whole point of the mock). Seed data covers the "give me
  N accounts with known tokens" bootstrap, plus optionally a handful of pre-existing
  relationships/statuses for tests that want to start mid-scenario.

## Config shape (recap from [01-architecture.md](01-architecture.md))

```toml
[[tool.mastodon_mock.seed.accounts]]
username = "alice"
display_name = "Alice"
note = "Test account alice"
locked = false
bot = false
access_token = "alice_token"

[[tool.mastodon_mock.seed.accounts]]
username = "bob"
display_name = "Bob"
locked = true            # bob requires follow approval
access_token = "bob_token"

[[tool.mastodon_mock.seed.accounts]]
username = "carol"
domain = "remote.example"  # "looks remote" — see federation non-goal in 00-overview.md
display_name = "Carol (Remote)"
access_token = "carol_token"

[[tool.mastodon_mock.seed.follows]]
follower = "alice"
following = "carol"

[[tool.mastodon_mock.seed.statuses]]
account = "carol"
text = "hello from a remote-looking account"
visibility = "public"
```

## `apply_seed_data(engine, seed_config)`

Implementation outline (`mastodon_mock/db/seed.py`):

```python
def apply_seed_data(engine: Engine, seed: SeedConfig) -> None:
    with Session(engine) as session:
        username_to_account: dict[str, Account] = {}

        for spec in seed.accounts:
            existing = session.scalar(select(Account).where(Account.username == spec.username, Account.domain == spec.domain))
            if existing is None:
                existing = Account(
                    id=next_id(),
                    username=spec.username,
                    domain=spec.domain,
                    display_name=spec.display_name or spec.username,
                    note=spec.note or "",
                    locked=spec.locked,
                    bot=spec.bot,
                    created_at=utcnow(),
                )
                session.add(existing)
                session.flush()
            username_to_account[spec.username] = existing

            if spec.access_token:
                token_exists = session.scalar(select(OAuthToken).where(OAuthToken.access_token == spec.access_token))
                if token_exists is None:
                    session.add(OAuthToken(
                        access_token=spec.access_token,
                        account_id=existing.id,
                        scopes=["read", "write", "follow", "push"],
                        created_at=utcnow(),
                    ))

        for follow in seed.follows:
            _ensure_follow(session, username_to_account[follow.follower], username_to_account[follow.following])

        for status_spec in seed.statuses:
            _ensure_seed_status(session, username_to_account[status_spec.account], status_spec)

        session.commit()
```

- **Account matching key**: `(username, domain)` — so re-running seed config is a
  no-op for accounts that already exist.
- **Token matching key**: `access_token` string — same idempotency rationale.
- **Follow matching**: `_ensure_follow` checks for an existing `relationships` row
  with `following=True` before creating one (and still applies the
  locked-target → `requested=True` logic from [02-data-model.md](02-data-model.md) if
  the target account is `locked`).
- **Seed statuses**: matched by `(account_id, text)` to avoid duplicate inserts on
  re-run. These get real `statuses` rows so they show up in timelines immediately —
  useful for "alice already has 3 posts" style fixtures without each test needing to
  post them.

## Default seed (zero-config mode)

If no `.mastodon_mock.toml`/`[tool.mastodon_mock]` is found at all
(`MastodonMockConfig.load()` falls through to defaults — see
[01-architecture.md](01-architecture.md)), the mock still seeds **one** account so
`account_verify_credentials()` works out of the box:

```python
DEFAULT_SEED = SeedConfig(
    accounts=[
        SeedAccount(username="testuser", display_name="Test User", access_token="mock_token"),
    ],
    follows=[],
    statuses=[],
)
```

This means `mastodon_mock serve` with zero config + `Mastodon(access_token="mock_token", api_base_url="http://127.0.0.1:3000")` works immediately — useful for quick manual
exploration with `curl`/`httpie` or a REPL.

## Multi-account follow/unfollow scenario (the user's motivating example)

No special seeding is required for the core scenario described in the prompt — it's
exactly what Mastodon.py + the mock's **Full**-coverage write endpoints already support
at runtime:

```python
alice = Mastodon(access_token="alice_token", api_base_url=BASE_URL)
bob   = Mastodon(access_token="bob_token",   api_base_url=BASE_URL)

bob_account = bob.account_verify_credentials()

# alice follows bob
alice.account_follow(bob_account.id)
assert alice.account_relationships(bob_account.id)[0].following is True

# bob posts
new_status = bob.status_post("hi from bob")

# alice sees it in her home timeline because she follows bob
home = alice.timeline_home()
assert any(s.id == new_status.id for s in home)

# alice unfollows
alice.account_unfollow(bob_account.id)
home_after = alice.timeline_home()
assert not any(s.id == new_status.id for s in home_after)  # bob's post no longer surfaced
# (existing posts made while following remain queryable via account_statuses,
#  but timeline_home only reflects *current* follow graph)

# notifications: bob got a 'follow' notification when alice followed him
bob_notifs = bob.notifications(types=["follow"])
assert any(n.account.id == alice.account_verify_credentials().id for n in bob_notifs)
```

This requires **no seed config beyond two accounts with known tokens** — which is
exactly the `[[tool.mastodon_mock.seed.accounts]]` minimal case.

## Resetting state between tests

Two supported patterns:

1. **Fresh app per test** (simplest, recommended for `:memory:`): the `live_server`
   fixture from [06-testing.md](06-testing.md) is function-scoped, so each test gets a
   brand-new `create_app()` → brand-new in-memory DB → re-applies seed config from
   scratch. Slight overhead (re-seeding, spinning up a thread) but total isolation.

1. **Session-scoped server + per-test DB reset**: for larger suites where spinning up
   uvicorn per test is too slow, a session-scoped server can expose a mock-only
   endpoint:

   ```
   POST /api/v1/_mock/reset
   ```

   which drops and recreates all tables (`Base.metadata.drop_all` +
   `Base.metadata.create_all`) and re-applies seed data, in one call. This is a
   **mock-only** endpoint (see `mock_only` test separation in
   [06-testing.md](06-testing.md)) — calling it against a real Mastodon instance would
   404, so it must never appear in shared (mock+real) test bodies, only in
   `conftest.py` fixture teardown/setup for the mock parametrization.

Both patterns are documented as supported; the spec does not mandate one — left to the
consuming project based on suite size.
