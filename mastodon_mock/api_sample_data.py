"""Generate sample data by exercising a running mastodon_mock HTTP API."""

from __future__ import annotations

import json
import random
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from mastodon_mock.config import SampleDataConfig
from mastodon_mock.db.sample_data import GenerationReport


@dataclass(frozen=True)
class _ApiAccount:
    """An account created through the mock development API."""

    id: str
    token: str


@dataclass(frozen=True)
class _ApiStatus:
    """A status created through the Mastodon API."""

    id: str
    owner_id: str


class SampleDataApiClient:
    """Small JSON client for the endpoints used by API-backed generation."""

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        """Create a client targeting ``base_url``."""
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        """Send one JSON request and return its object response."""
        headers = {"Accept": "application/json", "User-Agent": "mastodon_mock-gen-data"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"

        request = Request(urljoin(self.base_url, path.lstrip("/")), data=data, headers=headers, method=method)
        try:
            # The destination is the live server URL explicitly supplied by the CLI user.
            with urlopen(request, timeout=self.timeout) as response:  # nosec B310
                body = response.read()
        except HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Could not reach {self.base_url}: {exc.reason}") from exc

        decoded = json.loads(body) if body else {}
        if not isinstance(decoded, dict):
            raise RuntimeError(f"{method} {path} returned a non-object JSON response")
        return decoded


def generate_sample_data_via_api(
    base_url: str,
    cfg: SampleDataConfig,
    *,
    client: SampleDataApiClient | None = None,
) -> GenerationReport:
    """Append a sample cohort by calling a live server's write endpoints.

    Accounts use the mock-only development endpoint because standard Mastodon
    registration does not guarantee immediately usable credentials. All later
    operations use normal Mastodon write endpoints.
    """
    api = client or SampleDataApiClient(base_url)
    rng = random.Random(cfg.seed)  # nosec B311
    report = GenerationReport()
    started = time.perf_counter()
    suffix = secrets.token_hex(3)

    phase_started = time.perf_counter()
    accounts = _create_accounts(api, cfg.accounts, suffix)
    report.accounts = len(accounts)
    report.phase_seconds["accounts"] = time.perf_counter() - phase_started

    phase_started = time.perf_counter()
    relationship_keys, follow_notifications = _create_follows(api, cfg, rng, accounts)
    report.relationships = len(relationship_keys)
    report.phase_seconds["follows"] = time.perf_counter() - phase_started

    phase_started = time.perf_counter()
    statuses = _create_statuses(api, cfg, rng, accounts)
    report.statuses = len(statuses)
    report.phase_seconds["statuses"] = time.perf_counter() - phase_started

    phase_started = time.perf_counter()
    favourite_notifications = _create_engagement(api, cfg, rng, accounts, statuses, report)
    report.notifications = follow_notifications + favourite_notifications
    report.phase_seconds["engagement"] = time.perf_counter() - phase_started

    report.total_seconds = time.perf_counter() - started
    if report.total_seconds > 0:
        report.rows_per_second = report.total_rows / report.total_seconds
    return report


def _create_accounts(client: SampleDataApiClient, count: int, suffix: str) -> list[_ApiAccount]:
    """Create loginable local accounts through the mock development endpoint."""
    accounts: list[_ApiAccount] = []
    for index in range(count):
        username = f"gen_{suffix}_{index}"
        result = client.request(
            "POST",
            "/api/v1/_mock/dev_user",
            payload={"username": username, "display_name": f"Generated User {index}"},
        )
        accounts.append(_ApiAccount(id=str(result["id"]), token=str(result["access_token"])))
    return accounts


def _create_follows(
    client: SampleDataApiClient,
    cfg: SampleDataConfig,
    rng: random.Random,
    accounts: list[_ApiAccount],
) -> tuple[set[tuple[str, str]], int]:
    """Create follow edges through the standard account follow endpoint."""
    relationship_keys: set[tuple[str, str]] = set()
    notifications = 0
    for source in accounts:
        targets = [account for account in accounts if account.id != source.id]
        for target in rng.sample(targets, min(cfg.followers_per_account, len(targets))):
            client.request("POST", f"/api/v1/accounts/{target.id}/follow", token=source.token)
            relationship_keys.add((source.id, target.id))
            relationship_keys.add((target.id, source.id))
            notifications += 1
    return relationship_keys, notifications


def _create_statuses(
    client: SampleDataApiClient,
    cfg: SampleDataConfig,
    rng: random.Random,
    accounts: list[_ApiAccount],
) -> list[_ApiStatus]:
    """Create posts and replies through the standard statuses endpoint."""
    statuses: list[_ApiStatus] = []
    for account in accounts:
        for index in range(cfg.statuses_per_account):
            payload: dict[str, object] = {
                "status": f"Generated API post {index} from account {account.id} #sample",
                "visibility": "public",
            }
            if statuses and rng.random() < cfg.reply_ratio:
                payload["in_reply_to_id"] = rng.choice(statuses).id
            result = client.request("POST", "/api/v1/statuses", payload=payload, token=account.token)
            statuses.append(_ApiStatus(id=str(result["id"]), owner_id=account.id))
    return statuses


def _create_engagement(
    client: SampleDataApiClient,
    cfg: SampleDataConfig,
    rng: random.Random,
    accounts: list[_ApiAccount],
    statuses: list[_ApiStatus],
    report: GenerationReport,
) -> int:
    """Create favourites and bookmarks through standard status endpoints."""
    if not statuses:
        return 0

    notifications = 0
    favourite_count = min(cfg.favourites_per_account, len(statuses))
    bookmark_count = min(cfg.bookmarks_per_account, len(statuses))
    for account in accounts:
        for status in rng.sample(statuses, favourite_count):
            client.request("POST", f"/api/v1/statuses/{status.id}/favourite", token=account.token)
            report.favourites += 1
            if status.owner_id != account.id:
                notifications += 1
        for status in rng.sample(statuses, bookmark_count):
            client.request("POST", f"/api/v1/statuses/{status.id}/bookmark", token=account.token)
            report.bookmarks += 1
    return notifications
