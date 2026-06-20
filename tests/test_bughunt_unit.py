from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from mastodon_mock.db.base import Base
from mastodon_mock.db.models import Account, Notification, Status, StatusMention, StatusTag
from mastodon_mock.ids import next_id
from mastodon_mock.pagination import Page, link_header, paginate
from mastodon_mock.routers.statuses import _create_status_from_params, _validate_status_params
from mastodon_mock.serializers.instance import MAX_STATUS_CHARACTERS
from mastodon_mock.services import do_follow, do_unfollow, parse_hashtags, parse_mentions
from mastodon_mock.versioning import api_version_for, parse_version_string


@pytest.fixture
def db_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    try:
        with session_factory() as session:
            yield session
    finally:
        engine.dispose()


def test_parse_mentions(db_session: Session) -> None:
    # Setup accounts
    alice = Account(username="alice", display_name="Alice")
    bob = Account(username="bob", display_name="Bob", domain="remote.test")
    db_session.add_all([alice, bob])
    db_session.commit()

    # Test @username
    mentions = parse_mentions(db_session, "Hello @alice", exclude_account_id=999)
    assert len(mentions) == 1
    assert mentions[0].username == "alice"

    # Test @username@domain
    mentions = parse_mentions(db_session, "Hello @bob@remote.test", exclude_account_id=999)
    assert len(mentions) == 1
    assert mentions[0].username == "bob"
    assert mentions[0].domain == "remote.test"

    # Test exclusion
    mentions = parse_mentions(db_session, "Hello @alice", exclude_account_id=alice.id)
    assert len(mentions) == 0

    # Test multiple mentions
    mentions = parse_mentions(db_session, "@alice and @bob@remote.test", exclude_account_id=999)
    assert len(mentions) == 2
    assert {m.username for m in mentions} == {"alice", "bob"}

    # Test non-existent mention
    mentions = parse_mentions(db_session, "Hello @nobody", exclude_account_id=999)
    assert len(mentions) == 0


def test_parse_hashtags() -> None:
    assert parse_hashtags("Hello #world") == ["world"]
    assert parse_hashtags("#First #second") == ["first", "second"]
    assert parse_hashtags("#MixedCase") == ["mixedcase"]
    assert parse_hashtags("Not a #tag!") == ["tag"]
    # Mastodon hashtags don't usually start mid-word
    assert not parse_hashtags("word#notatag")
    assert parse_hashtags(" #tag") == ["tag"]


def test_do_follow_locked(db_session: Session) -> None:
    alice = Account(username="alice")
    bob = Account(username="bob", locked=True)
    db_session.add_all([alice, bob])
    db_session.commit()

    # Alice follows locked Bob
    rel = do_follow(db_session, alice, bob)
    assert rel.following is False
    assert rel.requested is True

    # Bob unfollows (rejects request)
    do_unfollow(db_session, alice, bob)
    assert rel.following is False
    assert rel.requested is False


def test_do_follow_unlocked(db_session: Session) -> None:
    alice = Account(username="alice")
    bob = Account(username="bob", locked=False)
    db_session.add_all([alice, bob])
    db_session.commit()

    # Alice follows unlocked Bob
    rel = do_follow(db_session, alice, bob)
    assert rel.following is True
    assert rel.requested is False

    # Alice unfollows Bob
    do_unfollow(db_session, alice, bob)
    assert rel.following is False


def test_validate_status_params() -> None:
    # Valid status
    assert _validate_status_params({"status": "Hello"}) is None

    # Empty status
    resp = _validate_status_params({"status": ""})
    assert resp is not None
    assert resp.status_code == 422

    # Too long status
    resp = _validate_status_params({"status": "a" * (MAX_STATUS_CHARACTERS + 1)})
    assert resp is not None
    assert resp.status_code == 422

    # Too many media attachments
    resp = _validate_status_params({"status": "hi", "media_ids": ["1", "2", "3", "4", "5"]})
    assert resp is not None
    assert resp.status_code == 422

    # Valid media attachments
    assert _validate_status_params({"status": "hi", "media_ids": ["1", "2", "3", "4"]}) is None

    # Poll makes it valid even if status is empty
    assert _validate_status_params({"status": "", "poll": {"options": ["a", "b"]}}) is None


def test_create_status_from_params(db_session: Session) -> None:
    alice = Account(username="alice")
    bob = Account(username="bob")
    db_session.add_all([alice, bob])
    db_session.commit()

    params = {"status": "Hello @bob #test", "visibility": "public"}

    status = _create_status_from_params(db_session, alice, params)
    db_session.commit()

    assert status.text == "Hello @bob #test"
    assert status.account_id == alice.id

    # Check mentions
    mentions = db_session.scalars(select(StatusMention).where(StatusMention.status_id == status.id)).all()
    assert len(mentions) == 1
    assert mentions[0].account_id == bob.id

    # Check tags
    tags = db_session.scalars(select(StatusTag).where(StatusTag.status_id == status.id)).all()
    assert len(tags) == 1
    assert tags[0].name == "test"

    # Check notification for bob
    notif = db_session.scalar(select(Notification).where(Notification.account_id == bob.id))
    assert notif is not None
    assert notif.type == "mention"
    assert notif.from_account_id == alice.id


def test_paginate_basic(db_session: Session) -> None:
    alice = Account(username="alice")
    db_session.add(alice)
    db_session.commit()

    # Create 10 statuses
    for i in range(10):
        db_session.add(Status(account_id=alice.id, content=f"Status {i}", text=f"Status {i}"))
    db_session.commit()

    query = select(Status).where(Status.account_id == alice.id)

    # Test default limit (20, but we only have 10)
    page = paginate(db_session, query, Status.id)
    assert len(page.items) == 10
    assert page.has_more is False
    # Newest first by default
    assert page.items[0].text == "Status 9"
    assert page.items[-1].text == "Status 0"

    # Test explicit limit
    page = paginate(db_session, query, Status.id, limit=5)
    assert len(page.items) == 5
    assert page.has_more is True
    assert page.items[0].text == "Status 9"
    assert page.items[-1].text == "Status 5"

    # Test max_id (exclusive)
    last_id = page.last_id
    page2 = paginate(db_session, query, Status.id, max_id=last_id, limit=5)
    assert len(page2.items) == 5
    assert page2.items[0].text == "Status 4"
    assert page2.items[-1].text == "Status 0"


def test_paginate_ignores_garbage_cursors(db_session: Session) -> None:
    """Non-numeric max_id/min_id/since_id/limit must be ignored, not 500.

    Regression for the crash surfaced by OpenAPI fuzzing: ``int(since_id)`` on a
    fuzzed/garbage query string raised ValueError. Real Mastodon ignores unparsable
    cursors and returns an unfiltered page. See tests/test_openapi_fuzz.py.
    """
    alice = Account(username="alice")
    db_session.add(alice)
    db_session.commit()
    for i in range(5):
        db_session.add(Status(account_id=alice.id, content=f"S{i}", text=f"S{i}"))
    db_session.commit()

    query = select(Status).where(Status.account_id == alice.id)

    # Garbage in every cursor + a non-numeric limit -> default, unfiltered page.
    page = paginate(
        db_session,
        query,
        Status.id,
        max_id="\x00garbage",
        min_id="not-an-int",
        since_id="💥",
        limit="nope",  # type: ignore[arg-type]
    )
    assert len(page.items) == 5
    assert page.limit == 20  # fell back to the default

    # A huge-but-valid int would overflow SQLite's 64-bit INTEGER on comparison; it must
    # be clamped, not raised. max_id far above any real id -> all rows still returned.
    page = paginate(db_session, query, Status.id, max_id="9" * 40)
    assert len(page.items) == 5


def test_paginate_min_id(db_session: Session) -> None:
    alice = Account(username="alice")
    db_session.add(alice)
    db_session.commit()

    # Create 10 statuses
    for i in range(10):
        db_session.add(Status(account_id=alice.id, content=f"Status {i}", text=f"Status {i}"))
    db_session.commit()

    query = select(Status).where(Status.account_id == alice.id)

    # Get middle page
    # If we have 10 items (0..9), limit 3 gives 9, 8, 7.
    # We want to test min_id.
    page_mid = paginate(
        db_session,
        query,
        Status.id,
        limit=3,
        max_id=db_session.scalar(select(Status.id).where(Status.text == "Status 7")),
    )  # 6, 5, 4
    min_id = page_mid.first_id  # Status 6

    page_newer = paginate(db_session, query, Status.id, limit=3, min_id=min_id)
    assert len(page_newer.items) == 3
    assert page_newer.items[2].text == "Status 7"
    assert page_newer.items[1].text == "Status 8"
    assert page_newer.items[0].text == "Status 9"


def test_link_header() -> None:
    page = Page(items=[1, 2, 3], limit=3, first_id=100, last_id=90, has_more=True)
    header = link_header("http://test/api", page)
    assert header is not None
    # pylint: disable=unsupported-membership-test
    assert "max_id=90" in header
    assert 'rel="next"' in header
    assert "min_id=100" in header
    assert 'rel="prev"' in header

    page_no_more = Page(items=[1, 2, 3], limit=3, first_id=100, last_id=90, has_more=False)
    header = link_header("http://test/api", page_no_more)
    assert header is not None
    assert "max_id" not in header
    assert "min_id=100" in header


def test_parse_version_string() -> None:
    assert parse_version_string("4.4.4") == (4, 4, 4)
    assert parse_version_string("4.4.0rc1") == (4, 4, 0)
    assert parse_version_string("4.5") == (4, 5, 0)
    assert parse_version_string("4") == (4, 0, 0)
    assert parse_version_string("") == (0, 0, 0)
    assert parse_version_string("invalid.version") == (0, 0, 0)


def test_api_version_for() -> None:
    assert api_version_for("4.4.4") == 2
    assert api_version_for("4.2.1") == 1
    assert api_version_for("4.0.0") == 1
    assert api_version_for("3.5.0") == 2  # default for unknown


def test_next_id() -> None:
    id1 = next_id()
    id2 = next_id()
    assert id2 > id1
    # Check that it's reasonably large (epoch ms)
    # 1700000000000 is ~Nov 2023
    assert id1 > 1700000000000
