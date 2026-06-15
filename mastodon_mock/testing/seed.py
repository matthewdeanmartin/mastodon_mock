"""The default seed used by the shipped test sugar.

Provides ``alice``/``bob``/``carol`` (logged-in-able) plus a tokenless "remote"
``dave``, matching the in-repo ``tests/conftest.py`` so the documented examples
just work out of the box.
"""

from __future__ import annotations

from mastodon_mock.config import SeedAccount, SeedConfig, SeedFollow

# These access tokens are fixtures for a mock server, not real credentials.
DEFAULT_TEST_SEED = SeedConfig(  # nosec B106
    accounts=[
        SeedAccount(username="alice", display_name="Alice", access_token="alice_token"),  # nosec B106
        SeedAccount(username="bob", display_name="Bob", access_token="bob_token"),  # nosec B106
        SeedAccount(username="carol", display_name="Carol", locked=True, access_token="carol_token"),  # nosec B106
        # A "remote" account (has a domain) used to exercise @user@domain mention
        # resolution and domain-block relationships. No token: not directly logged in.
        SeedAccount(username="dave", display_name="Dave", domain="remote.example"),
    ],
    follows=[SeedFollow(follower="alice", following="bob")],
)
