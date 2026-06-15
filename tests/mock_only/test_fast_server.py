"""Exercise the session-scoped server + /api/v1/_mock/reset pattern (spec/07 #2).

These prove the ``fast_server`` fixture resets state between tests: mutations made
in one test must not bleed into the next, even though both share one uvicorn
process. Mock-only because the reset endpoint is mastodon_mock-specific.
"""

from __future__ import annotations

import pytest
from mastodon import Mastodon

pytestmark = pytest.mark.mock_only


def _post_count(client: Mastodon) -> int:
    me = client.account_verify_credentials()
    return len(client.account_statuses(me.id, limit=40))


def test_fast_server_first_write(alice_fast: Mastodon) -> None:
    # alice starts from a clean seed (no statuses of her own).
    assert _post_count(alice_fast) == 0
    alice_fast.status_post("written in the first test")
    assert _post_count(alice_fast) == 1


def test_fast_server_state_is_reset(alice_fast: Mastodon) -> None:
    # If reset works, the status from the previous test is gone despite sharing
    # the same server process.
    assert _post_count(alice_fast) == 0


def test_fast_server_seed_intact_after_reset(alice_fast: Mastodon, bob_fast: Mastodon) -> None:
    # The seed (accounts + alice→bob follow) is re-applied on every reset.
    assert alice_fast.account_verify_credentials().username == "alice"
    bob_id = bob_fast.account_verify_credentials().id
    rel = alice_fast.account_relationships(bob_id)[0]
    assert rel.following is True
