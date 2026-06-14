#!/usr/bin/env bash
set -euo pipefail
source ./.bitrab-ci-scripts/setup.sh
uv run isort --check-only mastodon_mock tests
uv run black --check mastodon_mock tests
uv run ruff check --quiet mastodon_mock tests
uv run pylint --score=n --reports=n --rcfile=.pylintrc mastodon_mock
uv run pylint --score=n --reports=n --rcfile=.pylintrc_tests tests
