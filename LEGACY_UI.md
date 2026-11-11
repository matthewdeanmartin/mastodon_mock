# Mock-server UI ownership

`ui/` is the frozen, bundled administration and test client for `mastodon_mock`.
Do not add features or update it for Mastodon API changes.

The source baseline is `6239b715c77189e3c221ee241c7ab0563e9ec640` (2026-06-22),
frozen on November 11, 2026. `hatch_build.py` builds it for Python wheels;
see [installation](docs/installation.md) and [admin UI usage](docs/usage/admin-ui.md).

Continued client development and standalone deployments belong in
[Mawkingbird](https://github.com/matthewdeanmartin/mawkingbird) (`../mawkingbird`).
Do not automatically synchronize the two copies.
