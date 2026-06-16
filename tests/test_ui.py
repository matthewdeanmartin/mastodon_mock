"""Smoke tests for the bundled admin panel / client UI served at /_ui/.

The UI is built into ``mastodon_mock/_ui_dist`` by the Angular build (``make ui`` or the
packaging hook). When it has not been built (e.g. a fresh checkout in CI before the UI
step runs), the ``/_ui/`` mount is skipped and ``GET /`` omits its ``ui`` pointer. These
tests assert both branches so they pass either way. See spec/08-admin-ui.md.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from mastodon_mock.app import create_app
from mastodon_mock.ui import ui_dist_dir

UI_BUILT = (ui_dist_dir() / "index.html").is_file()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """A TestClient over a default in-memory app."""
    with TestClient(create_app()) as test_client:
        yield test_client


def test_root_identity_always_present(client: TestClient) -> None:
    """``GET /`` is always the JSON identity blob, UI or not."""
    body = client.get("/").json()
    assert body["mastodon_mock"] is True
    assert "version" in body


def test_root_advertises_ui_only_when_built(client: TestClient) -> None:
    """The ``ui`` pointer on ``GET /`` reflects whether the bundle was built."""
    body = client.get("/").json()
    assert ("ui" in body) == UI_BUILT
    if UI_BUILT:
        assert body["ui"] == "/_ui/"


@pytest.mark.skipif(not UI_BUILT, reason="UI not built (run `make ui`)")
def test_ui_index_served(client: TestClient) -> None:
    """``/_ui/`` serves the SPA shell."""
    resp = client.get("/_ui/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "<app-root" in resp.text


@pytest.mark.skipif(not UI_BUILT, reason="UI not built (run `make ui`)")
def test_ui_bare_path_redirects(client: TestClient) -> None:
    """``/_ui`` (no trailing slash) redirects to ``/_ui/``."""
    resp = client.get("/_ui", follow_redirects=False)
    assert resp.status_code in (307, 308)
    assert resp.headers["location"] == "/_ui/"


@pytest.mark.skipif(not UI_BUILT, reason="UI not built (run `make ui`)")
def test_ui_deep_link_falls_back_to_index(client: TestClient) -> None:
    """An unknown client-side route under /_ui/ falls back to index.html (SPA routing)."""
    resp = client.get("/_ui/statuses/123", follow_redirects=False)
    assert resp.status_code == 200
    assert "<app-root" in resp.text


@pytest.mark.skipif(not UI_BUILT, reason="UI not built (run `make ui`)")
def test_ui_does_not_shadow_api(client: TestClient) -> None:
    """The UI mount must not intercept API routes."""
    body = client.get("/api/v1/instance").json()
    assert "version" in body
