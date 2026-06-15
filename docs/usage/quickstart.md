# Quick Start

## Run the server

```bash
mastodon_mock serve --in-memory
```

By default it binds `127.0.0.1:3000` with an in-memory SQLite database seeded with a single
`testuser` account (token `mock_token`). Useful flags:

- `serve --config PATH` — load a `.mastodon_mock.toml` config file.
- `serve --host HOST --port PORT` — override the bind address.
- `serve --in-memory` — force an ephemeral in-memory database.
- `db upgrade` — run Alembic migrations against a file-backed database.

Run `mastodon_mock --help` for the full reference.

## Talk to it with Mastodon.py

```python
from mastodon import Mastodon

client = Mastodon(access_token="mock_token", api_base_url="http://127.0.0.1:3000")
status = client.status_post("hello from a mock!")
print(client.status(status.id).content)
```

## Use it in tests

The mock is designed to be started from a pytest fixture with your own seeded accounts, so
each test gets a fast, deterministic, multi-account Mastodon to drive. That's the main use
case — see **[Writing Tests Against the Mock](writing-tests.md)** for ready-made fixtures and
examples.

```python
from mastodon import Mastodon

alice = Mastodon(access_token="alice_token", api_base_url=live_server)
bob = Mastodon(access_token="bob_token", api_base_url=live_server)

alice.account_follow(bob.account_verify_credentials().id)
bob.status_post("hi alice")
assert any("hi alice" in s.content for s in alice.timeline_home())
```

## Configuration

Configuration is resolved in order: an explicit `--config` path (or `./.mastodon_mock.toml`),
then `[tool.mastodon_mock]` in `./pyproject.toml`, then built-in defaults. A minimal seed:

```toml
[[seed.accounts]]
username = "alice"
display_name = "Alice"
access_token = "alice_token"

[[seed.accounts]]
username = "bob"
access_token = "bob_token"

[[seed.follows]]
follower = "alice"
following = "bob"

[database]
path = ":memory:"
```

## Next steps

- [How It Works](../overview/how-it-works.md) — the model, the request lifecycle, and auth.
- [Writing Tests Against the Mock](writing-tests.md) — fixtures, examples, the dual-suite
  pattern.
- [What Is and Isn't Mocked](../reference/coverage.md) — coverage levels per API area.
