"""Run packaged migrations against a configured durable SQLite database."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import URL, create_engine, inspect

from mastodon_mock.config import DatabaseConfig
from mastodon_mock.db import models  # noqa: F401 (register the full ORM metadata)
from mastodon_mock.db.base import Base

__all__ = ["upgrade_database"]


def upgrade_database(database: DatabaseConfig) -> None:
    """Upgrade a durable database without depending on a checkout's Alembic config.

    Existing unversioned databases are adopted only when their schema exactly
    matches the current ORM metadata. Unknown schemas require a reviewed migration
    baseline; guessing a revision could skip needed migrations or destroy data.

    Args:
        database: The database settings used by the server.

    Raises:
        ValueError: The target is ephemeral or has an unknown unversioned schema.
    """
    if database.path == ":memory:":
        raise ValueError("db upgrade requires a file-backed [database].path; set it in --config.")
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic").replace("%", "%%"))
    database_url = URL.create("sqlite", database=database.path)
    cfg.set_main_option("sqlalchemy.url", database_url.render_as_string(hide_password=False).replace("%", "%%"))

    # `serve` and `gen-data` initialize the schema with create_all, without a revision.
    # Adopt those files only after validating them, never blindly stamp an old database.
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection)
            tables = set(inspect(connection).get_table_names()) - {"alembic_version"}
            adopt = bool(tables) and not context.get_current_heads()
            if adopt and compare_metadata(context, Base.metadata):
                raise ValueError(
                    "Unversioned database does not match the current schema. "
                    "Back it up and establish its migration baseline before upgrading; no schema changes were made."
                )
    finally:
        engine.dispose()
    if adopt:
        command.stamp(cfg, "head")
    command.upgrade(cfg, "head")
