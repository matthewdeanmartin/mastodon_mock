# Data Generation

`mastodon_mock` has two data paths with different goals:

- **Seed data** is small, deterministic startup state. It is applied when the app starts
  and is idempotent.
- **Sample data** is a throwaway bulk cohort for demos, UI testing, and performance work.
  It appends rows quickly and is not idempotent.

Use seed data when a test needs exact accounts, follows, and statuses. Use sample data
when you want a populated local instance with many timelines, favourites, bookmarks, and
relationships.

## Startup Seed Data

Seed data lives under `seed` in `.mastodon_mock.toml`, or under `[tool.mastodon_mock.seed]`
in `pyproject.toml`.

```toml
[[seed.accounts]]
username = "alice"
display_name = "Alice"
access_token = "alice_token"
role = "admin"

[[seed.accounts]]
username = "bob"
access_token = "bob_token"

[[seed.accounts]]
username = "remote_user"
domain = "example.social"

[[seed.follows]]
follower = "alice"
following = "bob"

[[seed.statuses]]
account = "bob"
text = "hello from seeded data"
visibility = "public"
```

Seeded accounts are matched by `(username, domain)`. Seeded statuses are matched by
`(account, text)`. Seeded access tokens are fixed strings, so tests can construct logged-in
clients directly.

## Bulk Sample Data CLI

`gen-data` writes a generated cohort into a SQLite database:

```bash
mastodon_mock gen-data --preset small --database ./mastodon_mock.sqlite --yes
```

Then point your config at the generated database and serve it:

```toml
[database]
path = "./mastodon_mock.sqlite"
```

```bash
mastodon_mock serve --config ./.mastodon_mock.toml
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--preset tiny|small|medium|large|huge` | Start from a named size profile. |
| `--accounts N` | Override generated account count. |
| `--statuses-per-account N` | Override statuses per generated account. |
| `--followers-per-account N` | Override follow graph density. |
| `--favourites-per-account N` | Override favourite edges per account. |
| `--seed N` | Make the generated graph reproducible. |
| `--database PATH` | Write into this SQLite file. |
| `--api URL` | Create the cohort through a running server's HTTP API. |
| `--json` | Print the generation report as JSON. |

The CLI refuses to write to `:memory:` unless you pass `--in-memory`, because an in-memory
database disappears as soon as the command exits.

To dogfood the server's own write paths, point `gen-data` at a running instance:

```bash
mastodon_mock gen-data --preset tiny --api http://127.0.0.1:3000 --yes
```

API mode creates accounts with the mock-only development-user endpoint, then uses normal
Mastodon endpoints for posts and replies, follows, favourites, and bookmarks. Follow and
favourite notifications are created naturally as API side effects. Because every generated
account must perform authenticated requests, all accounts receive a development token in
this mode. `--api` cannot be combined with `--database` or `--in-memory`.

## Config Defaults

The default profile used by `gen-data` and the browser sample-data endpoint can be set in
config:

```toml
[sample_data]
accounts = 100
followers_per_account = 20
statuses_per_account = 50
reply_ratio = 0.2
favourites_per_account = 10
bookmarks_per_account = 0
with_notifications = false
seed = 1234
chunk_size = 5000
```

Named presets scale those fields for common cases:

| Preset | Shape |
|---|---|
| `tiny` | 10 accounts, 5 follows each, 10 statuses each. |
| `small` | 100 accounts, 20 follows each, 50 statuses each. |
| `medium` | 1,000 accounts, 100 follows each, 100 statuses each. |
| `large` | 5,000 accounts, 1,000 follows each, 1,000 statuses each. |
| `huge` | 10,000 accounts, 1,000 follows each, 1,000 statuses each. |

Only the first 200 generated accounts receive login tokens, so the dev-user list stays
usable even for very large cohorts.

## Browser Endpoint

The running server exposes a mock-only endpoint used by the bundled UI:

```http
POST /api/v1/_mock/sample_data
```

Body fields are the same as `SampleDataConfig`, plus optional `preset`:

```json
{"preset": "small", "seed": 42}
```

It returns a `report` object with inserted row counts, timings, and rows-per-second.

The browser endpoint is capped at 2,000 accounts and roughly 750,000 estimated rows. Use
the CLI for larger cohorts.

## Resetting State

For tests or demos that need to return to startup state:

```http
POST /api/v1/_mock/reset
```

This drops and recreates all tables, then reapplies the configured seed data. It does not
reapply bulk-generated sample data unless the seed itself contains those rows.
