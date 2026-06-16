# Mastodon Mock

[![PyPI version](https://badge.fury.io/py/mastodon_mock.svg)](https://badge.fury.io/py/mastodon_mock)
[![CI](https://github.com/matthewdeanmartin/mastodon_mock/actions/workflows/build.yml/badge.svg)](https://github.com/matthewdeanmartin/mastodon_mock/actions/workflows/build.yml)
[![Python versions](https://img.shields.io/pypi/pyversions/mastodon_mock.svg)](https://pypi.org/project/mastodon_mock/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/LICENSE)

`mastodon_mock` is a stateful, in-process mock of the Mastodon REST API. It runs a real
FastAPI server backed by a minimal in-memory (or on-disk) SQLite database, so client code
— including [Mastodon.py](https://github.com/halcy/Mastodon.py) — can post statuses, follow
accounts, build timelines, manage lists and filters, and exercise OAuth flows against a
fast, deterministic, side-effect-free target. It is intended for testing and local
development where talking to a live Mastodon instance is slow, flaky, or undesirable.

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

Useful flags:

- `serve --config PATH` — load configuration from a `.mastodon_mock.toml` file.
- `serve --host HOST --port PORT` — override the bind address.
- `serve --in-memory` — force an ephemeral in-memory SQLite database.
- `db upgrade` — run Alembic migrations to bring an on-disk database to head.

Point a client at it (for example, with Mastodon.py):

```python
from mastodon import Mastodon

client = Mastodon(access_token="alice_token", api_base_url="http://127.0.0.1:8000")
client.status_post("hello from a mock!")
```

See `mastodon_mock --help` for the full command reference.

## Admin panel / web UI

`mastodon_mock` ships an Angular single-page app — a classic single-column Mastodon
client and admin panel — that drives its own REST API from the browser (dogfooding the
feature surface). When the server is running, open it at:

```
http://127.0.0.1:8000/_ui/
```

Sign in by pasting a seeded `access_token` (e.g. `mock_token`, or whatever you
configured under `[[tool.mastodon_mock.seed.accounts]]`). The UI covers timelines,
posting/replies, boosts/favourites/bookmarks, threads, profiles, follows, and
notifications. `GET /` advertises the UI via a `"ui": "/_ui/"` pointer when it is built.

The UI is prebuilt into the published wheel, so installed copies serve it with no extra
steps. Working from a source checkout, build it once with `make ui` (requires Node 22+);
the server runs fine without it and simply omits the `/_ui/` mount. See
[spec/08-admin-ui.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/spec/08-admin-ui.md)
for the build/packaging details. `make ui-dev` runs the Angular dev server.

## Configuration

Configuration is resolved in this order: an explicit `--config` path (or
`./.mastodon_mock.toml`), then a `[tool.mastodon_mock]` table in `./pyproject.toml`,
then built-in defaults. See [https://github.com/matthewdeanmartin/mastodon_mock/blob/main/docs/overview/README.md](docs/overview/README.md) for details.

## Contributing

See [CONTRIBUTING.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/docs/extending/CONTRIBUTING.md).

## License

MIT — see [LICENSE](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/LICENSE).

## Changelog

docs/overview/README.md
See [CHANGELOG.md](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/CHANGELOG.md).
