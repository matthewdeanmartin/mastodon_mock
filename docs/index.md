# mastodon_mock

`mastodon_mock` is a stateful, in-process mock of the
[Mastodon](https://docs.joinmastodon.org/api/) REST API. It runs a real
[FastAPI](https://fastapi.tiangolo.com/) server backed by a minimal in-memory (or on-disk)
SQLite database, so client code — including
[Mastodon.py](https://github.com/halcy/Mastodon.py) — can post statuses, follow accounts,
build timelines, manage lists and filters, and exercise OAuth flows against a fast,
deterministic, side-effect-free target. It is intended for testing and local development
where talking to a live Mastodon instance is slow, flaky, or undesirable.

## Why it exists

A test suite for Mastodon client code shouldn't have to choose between mocking every HTTP
call by hand and hitting a real, slow, stateful, rate-limited server. `mastodon_mock` gives
you a third option: a real server that *behaves* like Mastodon — writes are persisted and
reflected in later reads — but starts in milliseconds, forgets everything on exit, and is
seeded with exactly the accounts your test needs.

```python
from mastodon import Mastodon

alice = Mastodon(access_token="alice_token", api_base_url="http://127.0.0.1:3000")
bob = Mastodon(access_token="bob_token", api_base_url="http://127.0.0.1:3000")

alice.account_follow(bob.account_verify_credentials().id)
bob.status_post("hi alice")
assert any("hi alice" in s.content for s in alice.timeline_home())
```

In a pytest suite you don't even wire that up by hand. Install `mastodon_mock[test]` and a
ready-to-use server + logged-in clients arrive as fixtures — no `conftest.py` boilerplate:

```python
def test_follow(mastodon_mock_server):          # a fresh mock per test
    alice = mastodon_mock_server.client("alice")
    bob = mastodon_mock_server.client("bob")
    alice.account_follow(bob.account_verify_credentials().id)
    bob.status_post("hi alice")
    assert any("hi alice" in s.content for s in alice.timeline_home())
```

See **[Writing Tests](usage/writing-tests.md)** for the fixtures, the `mock_mastodon`
context manager / decorator, and seed customisation.

## Where to go next

- **[Overview](overview/README.md)** — what the mock covers and how config is resolved.
- **[How It Works](overview/how-it-works.md)** — the stateful model, the request lifecycle,
  and authentication. Split into sections for test authors and for contributors.
- **[Installation](installation.md)** — pipx, pip, or from source.
- **[Quick Start](usage/quickstart.md)** — run the server and talk to it.
- **[Writing Tests](usage/writing-tests.md)** — pytest fixtures, examples, and the dual
  mock/real suite pattern.
- **[What Is and Isn't Mocked](reference/coverage.md)** — coverage levels per API area.
- **[Contributing](extending/CONTRIBUTING.md)** — architecture and how to add an endpoint.

## Installation

```bash
pipx install mastodon_mock
```

## License

MIT.
