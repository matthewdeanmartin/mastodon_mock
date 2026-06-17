"""SQLAlchemy engine/session setup and declarative Base.

Handles the SQLite ``:memory:`` quirk by backing the engine with a private temp-file
database, so every threadpool request gets its own connection onto the same data
without sharing one fragile connection. See spec/01-architecture.md.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from mastodon_mock.config import DatabaseConfig


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def init_engine(config: DatabaseConfig) -> Engine:
    """Create a SQLAlchemy engine for the given database config.

    For ``:memory:`` we transparently back the engine with a *private temp-file*
    SQLite database (unique per engine, deleted on ``engine.dispose()``) rather than
    a true ``sqlite://`` in-memory DB.

    Why: a true in-memory SQLite is connection-scoped, so SQLAlchemy must share one
    DBAPI connection across the whole engine (``StaticPool``). But FastAPI runs sync
    endpoints in a threadpool, and a SQLite connection is not safe for concurrent use
    across threads — ``check_same_thread=False`` only silences the guard, it does not
    serialize access. Two threads interleaving statements on that single shared
    connection (e.g. a long-lived SSE stream resolving its account while a write
    commits) could make a query observe half-applied state and return wrong/empty
    rows, surfacing as intermittent, load-dependent failures — notably a 401 when an
    auth token lookup transiently saw nothing (only reproduced under ``pytest -n
    auto``). Shared-cache in-memory (``cache=shared``) trades that race for SQLite
    crashes under threaded load, so it is not viable either.

    A temp file lets the default connection pool hand each thread its **own**
    connection, with SQLite's normal file locking coordinating them safely. The DB
    stays ephemeral and isolated per app instance, preserving the ``:memory:``
    contract for tests.
    """
    if config.path == ":memory:":
        fd, db_path = tempfile.mkstemp(prefix=f"mastodon_mock_{uuid.uuid4().hex}_", suffix=".sqlite")
        os.close(fd)
        engine = create_engine(
            f"sqlite:///{db_path}",
            echo=config.echo,
            connect_args={"check_same_thread": False},
        )
        _delete_on_dispose(engine, db_path)
        return engine
    return create_engine(
        f"sqlite:///{config.path}",
        echo=config.echo,
        connect_args={"check_same_thread": False},
    )


def _delete_on_dispose(engine: Engine, db_path: str) -> None:
    """Remove the backing temp file when the engine is disposed.

    Keeps the ``:memory:`` contract (ephemeral, leaves nothing behind) for the
    temp-file-backed in-memory mode. Best-effort: a leftover file in the OS temp dir
    is harmless if removal races with a still-open handle.
    """

    @event.listens_for(engine, "engine_disposed")
    def _cleanup(_engine: Any) -> None:
        for suffix in ("", "-wal", "-shm"):
            with contextlib.suppress(OSError):
                os.remove(db_path + suffix)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return a configured ``sessionmaker`` bound to ``engine``."""
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
