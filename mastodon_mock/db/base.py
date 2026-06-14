"""SQLAlchemy engine/session setup and declarative Base.

Handles the SQLite ``:memory:`` quirk (connection-scoped DBs) by using a
``StaticPool`` so every request shares one connection. See spec/01-architecture.md.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from mastodon_mock.config import DatabaseConfig


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def init_engine(config: DatabaseConfig) -> Engine:
    """Create a SQLAlchemy engine for the given database config.

    For ``:memory:`` we must keep a single shared connection alive (StaticPool)
    so all threadpool requests see the same in-memory database.
    """
    if config.path == ":memory:":
        return create_engine(
            "sqlite://",
            echo=config.echo,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(
        f"sqlite:///{config.path}",
        echo=config.echo,
        connect_args={"check_same_thread": False},
    )


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return a configured ``sessionmaker`` bound to ``engine``."""
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
