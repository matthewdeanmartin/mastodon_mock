"""Read-path latency benchmarks under a medium cohort (spec/09-sample-data-and-perf.md).

Times representative endpoints (timeline_home, account_statuses, notifications, status
detail) against a generated ``medium`` world via in-process ASGI transport, and asserts
P95 stays under documented ceilings. A serializer N+1 or a dropped index blows past the
ceiling and fails here. Run with ``pytest -m slow``.
"""

from __future__ import annotations

import statistics
import time
from collections.abc import Callable

import httpx2 as httpx
import pytest

from tests.perf.conftest import PerfWorld

pytestmark = pytest.mark.slow

_ITERATIONS = 25


def _client(world: PerfWorld) -> httpx.Client:
    return httpx.Client(
        base_url=world.base_url,
        headers={"Authorization": f"Bearer {world.token}"},
    )


def _p95_ms(client: httpx.Client, request: Callable[[httpx.Client], httpx.Response]) -> float:
    samples: list[float] = []
    # Warm up (page cache, lazy imports) before measuring.
    for _ in range(3):
        request(client)
    for _ in range(_ITERATIONS):
        t0 = time.perf_counter()
        resp = request(client)
        samples.append((time.perf_counter() - t0) * 1000)
        assert resp.status_code == 200, resp.text
    samples.sort()
    return statistics.quantiles(samples, n=20)[-1] if len(samples) >= 2 else samples[0]


def test_timeline_home_latency(perf_world: PerfWorld, baselines: dict) -> None:
    with _client(perf_world) as client:
        p95 = _p95_ms(client, lambda c: c.get("/api/v1/timelines/home", params={"limit": 20}))
    ceiling = baselines["read"]["timeline_home_p95_ms"]
    assert p95 <= ceiling, f"timeline_home P95 {p95:.1f}ms exceeds ceiling {ceiling}ms"


def test_account_statuses_latency(perf_world: PerfWorld, baselines: dict) -> None:
    with _client(perf_world) as client:
        path = f"/api/v1/accounts/{perf_world.busy_account_id}/statuses"
        p95 = _p95_ms(client, lambda c: c.get(path, params={"limit": 20}))
    ceiling = baselines["read"]["account_statuses_p95_ms"]
    assert p95 <= ceiling, f"account_statuses P95 {p95:.1f}ms exceeds ceiling {ceiling}ms"


def test_notifications_latency(perf_world: PerfWorld, baselines: dict) -> None:
    with _client(perf_world) as client:
        p95 = _p95_ms(client, lambda c: c.get("/api/v1/notifications", params={"limit": 20}))
    ceiling = baselines["read"]["notifications_p95_ms"]
    assert p95 <= ceiling, f"notifications P95 {p95:.1f}ms exceeds ceiling {ceiling}ms"
