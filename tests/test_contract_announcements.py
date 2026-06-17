"""Contract tests for instance announcements + terms of service.

These surfaces are config-driven: announcements are seeded from config and the
ToS endpoint 404s unless ``terms_of_service`` is set. We build a dedicated server
with both configured (the shared conftest seed has neither), then drive it through
Mastodon.py per the project contract.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from mastodon import Mastodon
from mastodon.errors import MastodonNotFoundError

from mastodon_mock.config import (
    DatabaseConfig,
    MastodonMockConfig,
    SeedAccount,
    SeedAnnouncement,
    SeedConfig,
)
from mastodon_mock.testing import MockServer

_SEED = SeedConfig(
    accounts=[
        SeedAccount(username="alice", display_name="Alice", access_token="alice_token"),
        SeedAccount(username="bob", display_name="Bob", access_token="bob_token"),
    ],
    announcements=[
        SeedAnnouncement(content="Scheduled maintenance this weekend."),
        SeedAnnouncement(content="<p>Welcome to the instance!</p>"),
    ],
)


@pytest.fixture()
def server_with_announcements() -> Iterator[str]:
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=_SEED,
        terms_of_service="<p>Be excellent to each other.</p>",
    )
    with MockServer(config=config) as server:
        yield server.base_url


@pytest.fixture()
def alice(server_with_announcements: str) -> Mastodon:
    return Mastodon(access_token="alice_token", api_base_url=server_with_announcements)


@pytest.fixture()
def bob(server_with_announcements: str) -> Mastodon:
    return Mastodon(access_token="bob_token", api_base_url=server_with_announcements)


# --- Announcements ------------------------------------------------------------


def test_announcements_listed_from_config(alice: Mastodon) -> None:
    announcements = alice.announcements()
    assert len(announcements) == 2
    contents = " ".join(a.content for a in announcements)
    assert "maintenance" in contents
    # A bare body is wrapped in <p>; pre-wrapped markup is left alone.
    assert all(a.content.startswith("<p>") for a in announcements)
    assert all(a.read is False for a in announcements)


def test_announcement_dismiss_marks_read_per_user(alice: Mastodon, bob: Mastodon) -> None:
    target = alice.announcements()[0]
    alice.announcement_dismiss(target.id)

    # alice sees it as read...
    alice_view = next(a for a in alice.announcements() if a.id == target.id)
    assert alice_view.read is True
    # ...but bob does not (dismissal is per-account).
    bob_view = next(a for a in bob.announcements() if a.id == target.id)
    assert bob_view.read is False


def test_announcement_dismiss_is_idempotent(alice: Mastodon) -> None:
    target = alice.announcements()[0]
    alice.announcement_dismiss(target.id)
    alice.announcement_dismiss(target.id)  # no error
    assert next(a for a in alice.announcements() if a.id == target.id).read is True


def test_announcement_reactions(alice: Mastodon, bob: Mastodon) -> None:
    target = alice.announcements()[0]

    alice.announcement_reaction_create(target.id, "🎉")
    bob.announcement_reaction_create(target.id, "🎉")

    reacted = next(a for a in alice.announcements() if a.id == target.id)
    party = next(r for r in reacted.reactions if r.name == "🎉")
    assert party.count == 2
    assert party.me is True  # alice reacted

    # bob removing his reaction drops the count; alice still counted.
    bob.announcement_reaction_delete(target.id, "🎉")
    reacted = next(a for a in alice.announcements() if a.id == target.id)
    party = next(r for r in reacted.reactions if r.name == "🎉")
    assert party.count == 1
    assert party.me is True


def test_announcement_dismiss_unknown_is_404(alice: Mastodon) -> None:
    with pytest.raises(MastodonNotFoundError):
        alice.announcement_dismiss("999999999")


# --- Terms of service ---------------------------------------------------------


def test_terms_of_service_returned_when_configured(alice: Mastodon) -> None:
    tos = alice.instance_terms_of_service()
    assert "excellent" in tos.content
    assert tos.effective is True


def test_terms_of_service_404_when_unset() -> None:
    config = MastodonMockConfig(
        database=DatabaseConfig(path=":memory:"),
        seed=SeedConfig(accounts=[SeedAccount(username="alice", access_token="alice_token")]),
    )
    with MockServer(config=config) as server:
        client = Mastodon(access_token="alice_token", api_base_url=server.base_url)
        assert client.announcements() == []
        with pytest.raises(MastodonNotFoundError):
            client.instance_terms_of_service()
