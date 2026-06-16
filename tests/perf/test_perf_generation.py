"""Generation-throughput benchmarks (spec/09-sample-data-and-perf.md).

These are the regression guard for the bulk generator: a 2-3x slowdown (e.g. a lost
PRAGMA or an accidental per-row flush) drops rows/second below the baseline floor and
fails. Run with ``pytest -m slow``.
"""

from __future__ import annotations

import pytest

from mastodon_mock.config import PRESETS, DatabaseConfig
from mastodon_mock.db.base import Base, init_engine
from mastodon_mock.db.sample_data import generate_sample_data

pytestmark = pytest.mark.slow


@pytest.mark.parametrize("preset", ["small", "medium"])
def test_generation_throughput(preset: str, baselines: dict) -> None:
    engine = init_engine(DatabaseConfig(path=":memory:"))
    Base.metadata.create_all(engine)

    report = generate_sample_data(engine, PRESETS[preset].model_copy(update={"seed": 1}))

    floor = baselines["generate"][preset]["rows_per_second_min"]
    assert report.rows_per_second >= floor, (
        f"{preset}: {report.rows_per_second:,.0f} rows/s is below baseline {floor:,} "
        f"({report.total_rows:,} rows in {report.total_seconds:.2f}s)"
    )
