"""Write round-trip integration tests — mock backend only.

The dual ``mastodon_client`` fixture stays read-only so it is safe to point at a
real account. Write semantics (post → read-back → delete → 404) are still worth
exercising over a real HTTP server, so they run against the mock here and carry
the ``mock_only`` marker to keep them out of any real-backend selection.
"""

from __future__ import annotations

import pytest
from mastodon import Mastodon
from mastodon.errors import MastodonNotFoundError

pytestmark = pytest.mark.mock_only


@pytest.fixture()
def client(mock_server: str) -> Mastodon:
    return Mastodon(access_token="alice_token", api_base_url=mock_server)


def test_post_read_back_then_delete_404s(client: Mastodon) -> None:
    status = client.status_post("integration test post")
    fetched = client.status(status.id)
    assert fetched.content == status.content

    client.status_delete(status.id)
    with pytest.raises(MastodonNotFoundError):
        client.status(status.id)
