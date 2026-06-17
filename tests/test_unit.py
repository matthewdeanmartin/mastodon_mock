"""Unit tests for config loading, versioning, pagination, and seed idempotency."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select

from mastodon_mock.config import (
    DatabaseConfig,
    MastodonMockConfig,
    SeedAccount,
    SeedConfig,
    SeedStatus,
    demo_config,
)
from mastodon_mock.db.base import Base, init_engine, make_session_factory
from mastodon_mock.db.models import Account, OAuthToken, Status
from mastodon_mock.db.seed import apply_seed_data
from mastodon_mock.versioning import api_version_for, parse_version_string


def test_parse_version_string() -> None:
    assert parse_version_string("4.4.4") == (4, 4, 4)
    assert parse_version_string("4.3") == (4, 3, 0)
    assert parse_version_string("4.4.0rc1") == (4, 4, 0)


def test_api_version_for() -> None:
    assert api_version_for("4.4.4") == 2
    assert api_version_for("4.2.0") == 1
    assert api_version_for("9.9.9") == 2  # unknown → newest


def test_config_load_from_explicit_toml(tmp_path: Path) -> None:
    toml = tmp_path / ".mastodon_mock.toml"
    toml.write_text(
        'mocked_version = "4.3.9"\n'
        'domain = "example.test"\n'
        "[[seed.accounts]]\n"
        'username = "zed"\n'
        'access_token = "zed_token"\n'
    )
    config = MastodonMockConfig.load(toml)
    assert config.mocked_version == "4.3.9"
    assert config.domain == "example.test"
    assert config.seed.accounts[0].username == "zed"


def test_config_defaults() -> None:
    config = MastodonMockConfig()
    assert config.domain == "mock.local"
    assert config.seed.accounts[0].username == "testuser"


def test_seed_idempotency() -> None:
    engine = init_engine(DatabaseConfig(path=":memory:"))
    try:
        Base.metadata.create_all(engine)
        seed = SeedConfig(accounts=[SeedAccount(username="dup", access_token="dup_token")])

        apply_seed_data(engine, seed)
        apply_seed_data(engine, seed)  # re-apply

        factory = make_session_factory(engine)
        with factory() as session:
            account_count = session.scalar(select(func.count()).select_from(Account).where(Account.username == "dup"))
            token_count = session.scalar(
                select(func.count()).select_from(OAuthToken).where(OAuthToken.access_token == "dup_token")
            )
    finally:
        engine.dispose()
    assert account_count == 1
    assert token_count == 1


def test_seed_status_quote_resolves_ref() -> None:
    engine = init_engine(DatabaseConfig(path=":memory:"))
    try:
        Base.metadata.create_all(engine)
        seed = SeedConfig(
            accounts=[
                SeedAccount(username="poster", access_token="poster_token"),
                SeedAccount(username="quoter", access_token="quoter_token"),
            ],
            statuses=[
                SeedStatus(account="poster", text="Original thought.", ref="orig"),
                SeedStatus(account="quoter", text="Love this.", quotes="orig"),
            ],
        )
        apply_seed_data(engine, seed)

        factory = make_session_factory(engine)
        with factory() as session:
            original = session.scalar(select(Status).where(Status.text == "Original thought."))
            quoting = session.scalar(select(Status).where(Status.text == "Love this."))
            assert original is not None and quoting is not None
            assert quoting.quoted_status_id == original.id
    finally:
        engine.dispose()


def test_demo_config_is_rich_and_keeps_defaults_unchanged() -> None:
    demo = demo_config()
    assert demo.rules  # rules surfaced on the About page
    assert demo.terms_of_service  # ToS surfaced on the About page
    assert len(demo.seed.accounts) > 1
    assert any(s.quotes for s in demo.seed.statuses)  # a quote post for the demo
    assert demo.seed.announcements  # announcements banner has content

    # The library default config remains minimal (the test suite relies on this).
    default = MastodonMockConfig()
    assert default.rules == []
    assert default.terms_of_service == ""
    assert default.seed.accounts[0].username == "testuser"


def test_pig_latin_word_consonant_cluster() -> None:
    from mastodon_mock.text import pig_latin_word

    assert pig_latin_word("string") == "ingstray"
    assert pig_latin_word("hello") == "ellohay"


def test_pig_latin_word_vowel_start() -> None:
    from mastodon_mock.text import pig_latin_word

    assert pig_latin_word("apple") == "appleway"


def test_pig_latin_word_preserves_case() -> None:
    from mastodon_mock.text import pig_latin_word

    assert pig_latin_word("Quick") == "Uickqay"
    assert pig_latin_word("STRING") == "INGSTRAY"


def test_pig_latin_html_preserves_tags_and_entities() -> None:
    from mastodon_mock.text import pig_latin_html

    out = pig_latin_html('<p>Hello <a href="http://x.com">world</a> &amp; more</p>')
    # Tags, attributes and entities are untouched; only visible words transform.
    assert '<a href="http://x.com">' in out
    assert "&amp;" in out
    assert "ellohay" in out.lower()
    assert "orldway" in out.lower()
