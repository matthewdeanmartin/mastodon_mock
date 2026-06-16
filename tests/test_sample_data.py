"""Unit tests for the bulk sample-data generator (spec/09-sample-data-and-perf.md)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from mastodon_mock.config import PRESETS, DatabaseConfig, SampleDataConfig
from mastodon_mock.db.base import Base, init_engine
from mastodon_mock.db.models import Account, Bookmark, Favourite, OAuthToken, Relationship, Status
from mastodon_mock.db.sample_data import estimate_rows, generate_sample_data


@pytest.fixture()
def engine() -> Iterator[Engine]:
    eng = init_engine(DatabaseConfig(path=":memory:"))
    Base.metadata.create_all(eng)
    try:
        yield eng
    finally:
        eng.dispose()


def _count(engine: Engine, model: type[object]) -> int:
    with Session(engine) as s:
        return s.scalar(select(func.count()).select_from(model)) or 0


def test_tiny_generates_expected_account_and_status_counts(engine: Engine) -> None:
    cfg = SampleDataConfig(accounts=10, followers_per_account=5, statuses_per_account=10, favourites_per_account=3)
    report = generate_sample_data(engine, cfg)

    assert report.accounts == 10
    assert _count(engine, Account) == 10
    assert report.statuses == 100
    assert _count(engine, Status) == 100
    assert report.favourites == 30
    assert _count(engine, Favourite) == 30
    assert report.total_seconds > 0
    assert report.rows_per_second > 0


def test_tokens_are_capped_but_accounts_loginable(engine: Engine) -> None:
    cfg = SampleDataConfig(accounts=5, followers_per_account=2, statuses_per_account=1)
    generate_sample_data(engine, cfg)
    # Every account in a tiny cohort gets a token (under the cap).
    assert _count(engine, OAuthToken) == 5


def test_no_orphan_foreign_keys(engine: Engine) -> None:
    cfg = SampleDataConfig(accounts=20, followers_per_account=5, statuses_per_account=10, bookmarks_per_account=2)
    generate_sample_data(engine, cfg)

    with Session(engine) as s:
        account_ids = set(s.scalars(select(Account.id)).all())
        status_ids = set(s.scalars(select(Status.id)).all())

        for status in s.scalars(select(Status)).all():
            assert status.account_id in account_ids
            if status.in_reply_to_id is not None:
                assert status.in_reply_to_id in status_ids
        for rel in s.scalars(select(Relationship)).all():
            assert rel.source_account_id in account_ids
            assert rel.target_account_id in account_ids
        for fav in s.scalars(select(Favourite)).all():
            assert fav.account_id in account_ids and fav.status_id in status_ids
        for bm in s.scalars(select(Bookmark)).all():
            assert bm.account_id in account_ids and bm.status_id in status_ids


def test_relationship_pairs_are_unique(engine: Engine) -> None:
    cfg = SampleDataConfig(accounts=30, followers_per_account=10, statuses_per_account=0)
    generate_sample_data(engine, cfg)

    with Session(engine) as s:
        pairs = s.execute(select(Relationship.source_account_id, Relationship.target_account_id)).all()
    assert len(pairs) == len(set(pairs))


def test_seed_makes_generation_reproducible() -> None:
    cfg = SampleDataConfig(accounts=10, followers_per_account=3, statuses_per_account=5, seed=42)

    counts = []
    for _ in range(2):
        eng = init_engine(DatabaseConfig(path=":memory:"))
        try:
            Base.metadata.create_all(eng)
            report = generate_sample_data(eng, cfg)
            counts.append((report.relationships, report.statuses, report.favourites))
        finally:
            eng.dispose()
    assert counts[0] == counts[1]


def test_appends_rather_than_replacing(engine: Engine) -> None:
    cfg = SampleDataConfig(accounts=5, followers_per_account=2, statuses_per_account=4)
    generate_sample_data(engine, cfg)
    generate_sample_data(engine, cfg)
    assert _count(engine, Account) == 10
    assert _count(engine, Status) == 40


def test_estimate_rows_is_in_the_ballpark(engine: Engine) -> None:
    cfg = PRESETS["tiny"]
    est = estimate_rows(cfg)
    report = generate_sample_data(engine, cfg)
    # Estimate counts both directed relationship rows; actual dedupes mutuals, so the
    # estimate is an upper bound on relationships and total rows.
    assert report.total_rows <= est
    assert report.total_rows > est * 0.5
