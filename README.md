# Mastodon Mock

[![PyPI version](https://badge.fury.io/py/mastodon_mock.svg)](https://badge.fury.io/py/mastodon_mock)
[![CI](https://github.com/matthewdeanmartin/mastodon_mock/actions/workflows/build.yml/badge.svg)](https://github.com/matthewdeanmartin/mastodon_mock/actions/workflows/build.yml)
[![Python versions](https://img.shields.io/pypi/pyversions/mastodon_mock.svg)](https://pypi.org/project/mastodon_mock/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/LICENSE)

`mastodon_mock` is a stateful, local Mastodon REST API for tests and development. It runs a
real FastAPI server backed by in-memory or file-backed SQLite, so client code can post
statuses, follow accounts, build timelines, manage lists and filters, file reports, and
exercise OAuth/admin flows without touching a live instance.

Use it when you want the confidence of real HTTP and persisted state, without flaky
network tests, rate limits, public test posts, or hand-written response mocks.

Highlights:

- Real Mastodon-shaped HTTP API, tested against [Mastodon.py](https://github.com/halcy/Mastodon.py).
- Fast disposable SQLite state, with deterministic seed data and reset support.
- Pytest fixtures, a context manager, and decorator sugar for zero-boilerplate tests.
- Bulk sample-data generation for demos, UI work, and performance checks.
- Bundled web client and admin UI at `/_ui/` when the package includes the built frontend.
- Admin/moderation endpoints for account actions, reports, domain blocks, email blocks, and IP blocks.

## Installation

```bash
pipx install mastodon_mock
```

Or with pip:

```bash
pip install mastodon_mock
```

## Usage

Run the mock server:

```bash
mastodon_mock serve --in-memory
```

Point a client at it:

```python
from mastodon import Mastodon

client = Mastodon(access_token="mock_token", api_base_url="http://127.0.0.1:3000")
client.status_post("hello from a mock!")
```

Open `http://127.0.0.1:3000/_ui/` for the bundled browser UI when it is available.

For a populated local instance, generate a throwaway cohort into a SQLite file and point
your config's `[database].path` at it:

```bash
mastodon_mock gen-data --preset small --database ./mastodon_mock.sqlite --yes
```

## Documentation

See the [documentation](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/docs/index.md)
for configuration, fixtures, endpoint coverage, data generation, and admin UI/API details.

## Contributing

See [CONTRIBUTING.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/docs/extending/CONTRIBUTING.md).

## License

MIT. See [LICENSE](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/LICENSE).

## Changelog

See [CHANGELOG.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/CHANGELOG.md).
