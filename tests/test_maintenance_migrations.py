"""Verify upgrades from the pre-maintenance persistent schema."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import JSON, Boolean, DateTime, Integer, MetaData, Table, create_engine, select

from mastodon_mock.db.base import Base
from mastodon_mock.db.models import utcnow


def test_upgrade_preserves_existing_accounts_and_matches_models(tmp_path: Path) -> None:
    """Both sprint migrations preserve rows and produce the exact ORM schema."""
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "mastodon_mock" / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{tmp_path / 'upgrade.sqlite'}")
    command.upgrade(config, "e7a91c5b3d42")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    old_accounts = Table("accounts", MetaData(), autoload_with=engine)
    values = {}
    for column in old_accounts.columns:
        if column.nullable:
            values[column.name] = None
        elif isinstance(column.type, Boolean):
            values[column.name] = False
        elif isinstance(column.type, Integer):
            values[column.name] = 123
        elif isinstance(column.type, DateTime):
            values[column.name] = utcnow()
        elif isinstance(column.type, JSON):
            values[column.name] = []
        else:
            values[column.name] = "preserved"
    with engine.begin() as connection:
        connection.execute(old_accounts.insert().values(**values))
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        account = connection.execute(select(Base.metadata.tables["accounts"])).mappings().one()
        assert account["username"] == "preserved"
        assert account["avatar_description"] == ""
        assert account["header_description"] == ""
        assert account["invalid_handle"] is False
        assert account["requested_deletion_at"] is None
    command.downgrade(config, "e7a91c5b3d42")
    with engine.connect() as connection:
        assert connection.execute(select(old_accounts.c.username)).scalar_one() == "preserved"
    engine.dispose()
