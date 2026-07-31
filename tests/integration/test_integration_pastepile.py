"""Live Pastepile integration checks: is one API key really reusable forever?

These talk to the real https://www.pastepile.com and are opt-in, because they
create pastes on a public service. Enable with::

    RUN_PASTEPILE_TESTS=1 uv run pytest tests/integration/test_integration_pastepile.py

Every paste created here is ``unlisted`` with a 10-minute expiry, so nothing
durable is left on the service even if a cleanup step is missed.

## The key model these tests pin down

Pastepile has **two** different credentials, and conflating them is the mistake
this file exists to prevent:

* **API key** (``X-API-Key: pk_live_…``) — identifies *you*, not a paste. It is
  reusable indefinitely across any number of pastes, and it is what makes
  ``?scope=mine`` list them. Free, no account, minted by ``POST /api/keys``.
* **edit_key** (``X-Edit-Key``) — returned once per paste at creation and scoped
  to **that one paste**; it authorises editing or deleting it.

So a key is emphatically *not* per-paste. ``test_one_key_creates_many_pastes``
is the assertion that keeps that true.

## Why the key is cached in .env

``POST /api/keys`` is rate-limited to **5 keys per day per IP**. A suite that
minted a fresh key every run would exhaust that in a morning and then fail for
reasons unrelated to the code under test. So: reuse ``PASTEPILE_API_KEY`` from
the environment or ``.env``; mint one only when none exists, and write it back.
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path

import httpx
import pytest

from tests.integration.conftest import _parse_env_file

SITE = "https://www.pastepile.com"
API = f"{SITE}/api/public/pastes"
KEYS = f"{SITE}/api/keys"
ENV_VAR = "PASTEPILE_API_KEY"
REPO_ENV = Path(__file__).resolve().parents[2] / ".env"

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_PASTEPILE_TESTS") != "1",
    reason="Live Pastepile tests are opt-in; set RUN_PASTEPILE_TESTS=1.",
)


def _read_cached_key() -> str | None:
    """The API key from the environment, falling back to the repo's .env."""
    from_env = os.environ.get(ENV_VAR)
    if from_env:
        return from_env.strip() or None
    return _parse_env_file(REPO_ENV).get(ENV_VAR) or None


def _append_key_to_env(key: str) -> None:
    """Persist a freshly minted key so later runs reuse it (5 mints/day/IP).

    Fills in an existing empty ``PASTEPILE_API_KEY=`` placeholder in place, and
    otherwise appends. Never rewrites a line that already holds a value, and
    never rewrites the whole file: .env holds unrelated credentials and this must
    not be the thing that eats them.
    """
    if not REPO_ENV.exists():
        REPO_ENV.write_text(f"{ENV_VAR}={key}\n", encoding="utf-8")
        return

    lines = REPO_ENV.read_text(encoding="utf-8").splitlines(keepends=True)
    for index, raw in enumerate(lines):
        stripped = raw.strip()
        candidate = stripped[len("export ") :] if stripped.startswith("export ") else stripped
        if not candidate.startswith(f"{ENV_VAR}="):
            continue
        if candidate[len(ENV_VAR) + 1 :].strip().strip('"').strip("'"):
            return  # Already holds a real key; leave it alone.
        lines[index] = f"{ENV_VAR}={key}\n"
        REPO_ENV.write_text("".join(lines), encoding="utf-8")
        return

    body = "".join(lines)
    separator = "" if not body or body.endswith("\n") else "\n"
    REPO_ENV.write_text(f"{body}{separator}{ENV_VAR}={key}\n", encoding="utf-8")


@pytest.fixture(scope="module")
def api_key() -> str:
    """A reusable Pastepile API key: cached if we have one, minted once if not."""
    cached = _read_cached_key()
    if cached:
        return cached

    response = httpx.post(KEYS, json={"label": "mastodon_mock integration"}, timeout=30)
    if response.status_code == 429:
        pytest.skip(f"Pastepile key generation is rate-limited (5/day/IP) and no {ENV_VAR} is cached. Try again later.")
    response.raise_for_status()
    minted = response.json()
    key = minted.get("key")
    assert key, f"Pastepile returned no key: {minted}"
    _append_key_to_env(key)
    return str(key)


def _create(key: str, title: str) -> dict:
    """Create a short-lived unlisted paste with the given key."""
    response = httpx.post(
        API,
        json={
            "title": title,
            "content": f"integration probe: {title}",
            "language": "plaintext",
            "expiry": "10m",
            "visibility": "unlisted",
        },
        headers={"X-API-Key": key},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _delete(slug: str, edit_key: str) -> None:
    """Best-effort cleanup. Pastes also expire on their own in 10 minutes."""
    with contextlib.suppress(httpx.HTTPError):
        httpx.request(
            "DELETE",
            f"{API}/{slug}",
            headers={"X-Edit-Key": edit_key},
            timeout=30,
        )


def test_one_key_creates_many_pastes(api_key: str) -> None:
    """The core claim: an API key is reusable, not scoped to a single paste."""
    created = []
    try:
        for index in range(3):
            paste = _create(api_key, f"reuse probe {index}")
            assert paste.get("slug"), f"no slug in {paste}"
            created.append(paste)

        # Three distinct pastes from one key — a per-paste key could not do this.
        slugs = {paste["slug"] for paste in created}
        assert len(slugs) == 3

        # And each got its OWN edit key, which is the genuinely per-paste secret.
        edit_keys = {paste["edit_key"] for paste in created}
        assert len(edit_keys) == 3
    finally:
        for paste in created:
            _delete(paste["slug"], paste["edit_key"])


def test_scope_mine_lists_pastes_made_with_the_key(api_key: str) -> None:
    """Post, then see your own paste — the loop that justifies the feed."""
    paste = _create(api_key, "scope mine probe")
    try:
        response = httpx.get(
            API,
            params={"scope": "mine", "limit": 50},
            headers={"X-API-Key": api_key},
            timeout=30,
        )
        response.raise_for_status()
        slugs = [item["slug"] for item in response.json().get("items", [])]

        # Unlisted, and still listed for its creator — which the public feed omits.
        assert paste["slug"] in slugs
    finally:
        _delete(paste["slug"], paste["edit_key"])


def test_scope_mine_requires_the_header_not_a_query_param(api_key: str) -> None:
    """Query-parameter auth is silently ignored, which would read as "no pastes"."""
    paste = _create(api_key, "header auth probe")
    try:
        via_param = httpx.get(
            API,
            params={"scope": "mine", "limit": 50, "key": api_key},
            timeout=30,
        )
        # No header: either an explicit refusal or a list that excludes the paste.
        if via_param.status_code == 200:
            slugs = [item["slug"] for item in via_param.json().get("items", [])]
            assert paste["slug"] not in slugs
        else:
            assert via_param.status_code in (401, 403)
    finally:
        _delete(paste["slug"], paste["edit_key"])


def test_edit_key_is_scoped_to_its_own_paste(api_key: str) -> None:
    """One paste's edit key must not grant power over another's."""
    first = _create(api_key, "edit scope A")
    second = _create(api_key, "edit scope B")
    try:
        crossed = httpx.request(
            "DELETE",
            f"{API}/{second['slug']}",
            headers={"X-Edit-Key": first["edit_key"]},
            timeout=30,
        )
        assert crossed.status_code in (401, 403, 404)

        # The rightful key still works.
        proper = httpx.request(
            "DELETE",
            f"{API}/{second['slug']}",
            headers={"X-Edit-Key": second["edit_key"]},
            timeout=30,
        )
        assert proper.status_code < 400
    finally:
        _delete(first["slug"], first["edit_key"])


def test_key_survives_between_runs(api_key: str) -> None:
    """A cached key keeps working, which is what makes caching it worthwhile."""
    response = httpx.get(
        API,
        params={"scope": "mine", "limit": 1},
        headers={"X-API-Key": api_key},
        timeout=30,
    )

    # An expired or revoked key would 401 here rather than answering.
    assert response.status_code == 200
