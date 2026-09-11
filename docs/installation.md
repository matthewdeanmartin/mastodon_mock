# Installation

## Recommended (pipx)

```bash
pipx install mastodon_mock
```

## pip

```bash
pip install mastodon_mock
```

## From source

Install [uv](https://docs.astral.sh/uv/) and a supported Node.js version first
(Node 22.12 or newer in the Node 22 series, or Node 24+), including npm.
The Python build hook runs `npm ci` and compiles the bundled lite UI during
source and editable installs. Installing a published wheel does not require Node.

```bash
git clone https://github.com/matthewdeanmartin/mastodon_mock.git
cd mastodon_mock
uv sync
```

For contributors, use `uv sync --all-extras` to install the optional test and
contract-check dependencies too. Source distributions contain the UI source and
lockfile, but exclude `node_modules`, virtual environments, and build caches.
