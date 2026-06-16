from __future__ import annotations

import pytest

from mastodon_mock.config import MastodonMockConfig, SeedAccount, SeedConfig
from mastodon_mock.testing.server import MockServer
from mastodon_mock.testing.sugar import mock_mastodon


def test_mock_server_value_error_both_config_and_seed() -> None:
    config = MastodonMockConfig()
    seed = SeedConfig()
    with pytest.raises(ValueError, match=r"Pass either `config` or `seed`, not both."):
        MockServer(config=config, seed=seed)


def test_mock_server_port_error_before_start() -> None:
    server = MockServer()
    with pytest.raises(RuntimeError, match=r"MockServer is not started; call start\(\) first"):
        _ = server.port


def test_mock_server_client_value_error_both_username_and_token() -> None:
    server = MockServer()
    with pytest.raises(ValueError, match=r"Pass either `username` or `token`, not both."):
        server.client(username="alice", token="token")


def test_mock_server_resolve_token_no_accounts() -> None:
    config = MastodonMockConfig(seed=SeedConfig(accounts=[]))
    server = MockServer(config=config)
    with pytest.raises(LookupError, match=r"No seeded account has an access_token to log in with."):
        server._resolve_token(None)


def test_mock_server_resolve_token_missing_username() -> None:
    config = MastodonMockConfig(seed=SeedConfig(accounts=[SeedAccount(username="alice", access_token="t")]))
    server = MockServer(config=config)
    with pytest.raises(LookupError, match="No seeded account named 'bob'"):
        server._resolve_token("bob")


def test_mock_server_resolve_token_account_no_token() -> None:
    config = MastodonMockConfig(seed=SeedConfig(accounts=[SeedAccount(username="alice", access_token=None)]))
    server = MockServer(config=config)
    with pytest.raises(LookupError, match="Seeded account 'alice' has no access_token"):
        server._resolve_token("alice")


def test_sugar_mock_mastodon_bare_decorator() -> None:
    @mock_mastodon
    def my_test(mastodon_server):
        assert isinstance(mastodon_server, MockServer)
        assert mastodon_server.started

    my_test()


def test_sugar_mock_mastodon_custom_inject_as() -> None:
    @mock_mastodon(inject_as="custom_server")
    def my_test(custom_server):
        assert isinstance(custom_server, MockServer)

    my_test()


def test_sugar_mock_mastodon_no_inject() -> None:
    @mock_mastodon(inject=False)
    def my_test(**kwargs):
        assert "mastodon_server" not in kwargs

    my_test()
