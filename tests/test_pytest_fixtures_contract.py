"""Consumer-facing tests for the pytest fixtures exported by mastodon_mock."""

from __future__ import annotations

import pytest

pytest_plugins = ["pytester"]


def test_default_server_and_client_fixtures_are_usable(pytester: pytest.Pytester) -> None:
    pytester.makepyfile(
        """
        from mastodon_mock.testing.server import MockServer


        def test_server_fixture_yields_started_mock_server(mastodon_mock_server):
            assert isinstance(mastodon_mock_server, MockServer)
            assert mastodon_mock_server.started is True
            assert mastodon_mock_server.base_url.startswith("http://127.0.0.1:")


        def test_client_fixture_logs_in_as_first_default_seeded_account(mastodon_mock_client):
            account = mastodon_mock_client.account_verify_credentials()
            assert account.username == "alice"
            assert account.acct == "alice"
        """
    )

    result = pytester.runpytest("-q")

    result.assert_outcomes(passed=2)


def test_project_can_override_default_config_fixture(pytester: pytest.Pytester) -> None:
    pytester.makeconftest(
        """
        import pytest

        from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig


        @pytest.fixture
        def mastodon_mock_config():
            return MastodonMockConfig(
                database=DatabaseConfig(path=":memory:"),
                seed=SeedConfig(
                    accounts=[
                        SeedAccount(
                            username="fixture_user",
                            display_name="Fixture User",
                            access_token="fixture_token",
                        )
                    ]
                ),
            )
        """
    )
    pytester.makepyfile(
        """
        def test_client_uses_project_config_fixture(mastodon_mock_client):
            account = mastodon_mock_client.account_verify_credentials()
            assert account.username == "fixture_user"
            assert account.display_name == "Fixture User"
        """
    )

    result = pytester.runpytest("-q")

    result.assert_outcomes(passed=1)


def test_marker_seed_takes_precedence_over_project_config_fixture(pytester: pytest.Pytester) -> None:
    pytester.makeconftest(
        """
        import pytest

        from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig


        @pytest.fixture
        def mastodon_mock_config():
            return MastodonMockConfig(
                database=DatabaseConfig(path=":memory:"),
                seed=SeedConfig(
                    accounts=[
                        SeedAccount(username="config_user", access_token="config_token")
                    ]
                ),
            )
        """
    )
    pytester.makepyfile(
        """
        import pytest

        from mastodon_mock.config import SeedAccount, SeedConfig


        @pytest.mark.mastodon_mock(
            seed=SeedConfig(
                accounts=[
                    SeedAccount(
                        username="marker_user",
                        display_name="Marker User",
                        access_token="marker_token",
                    )
                ]
            )
        )
        def test_marker_seed_wins(mastodon_mock_client):
            account = mastodon_mock_client.account_verify_credentials()
            assert account.username == "marker_user"
            assert account.display_name == "Marker User"
        """
    )

    result = pytester.runpytest("-q")

    result.assert_outcomes(passed=1)


def test_marker_config_can_override_one_test_without_leaking(pytester: pytest.Pytester) -> None:
    pytester.makepyfile(
        """
        import pytest

        from mastodon_mock.config import DatabaseConfig, MastodonMockConfig, SeedAccount, SeedConfig

        MARKER_CONFIG = MastodonMockConfig(
            database=DatabaseConfig(path=":memory:"),
            seed=SeedConfig(
                accounts=[
                    SeedAccount(username="marked", access_token="marked_token")
                ]
            ),
        )


        @pytest.mark.mastodon_mock(config=MARKER_CONFIG)
        def test_marker_config_applies_to_marked_test(mastodon_mock_client):
            assert mastodon_mock_client.account_verify_credentials().username == "marked"


        def test_unmarked_test_gets_builtin_default_seed(mastodon_mock_client):
            assert mastodon_mock_client.account_verify_credentials().username == "alice"
        """
    )

    result = pytester.runpytest("-q")

    result.assert_outcomes(passed=2)


def test_session_reset_fixture_restores_seed_state_between_tests(pytester: pytest.Pytester) -> None:
    pytester.makepyfile(
        """
        def test_can_mutate_session_server_after_reset(mastodon_mock_reset):
            client = mastodon_mock_reset.client("alice")
            posted = client.status_post("temporary session state")
            assert any(status.id == posted.id for status in client.account_statuses(client.account_verify_credentials().id))


        def test_next_test_starts_from_seed_again(mastodon_mock_reset):
            client = mastodon_mock_reset.client("alice")
            account = client.account_verify_credentials()
            statuses = client.account_statuses(account.id)
            assert all(status.content != "<p>temporary session state</p>" for status in statuses)
        """
    )

    result = pytester.runpytest("-q")

    result.assert_outcomes(passed=2)
