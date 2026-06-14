"""FastAPI application factory."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from mastodon_mock.config import MastodonMockConfig
from mastodon_mock.db.base import Base, init_engine, make_session_factory
from mastodon_mock.db.seed import apply_seed_data
from mastodon_mock.routers import (
    accounts,
    conversations,
    favourites_bookmarks,
    filters,
    instance,
    lists,
    media,
    notifications,
    oauth,
    polls,
    preferences,
    relationships,
    search,
    statuses,
    timelines,
)


def create_app(config: MastodonMockConfig | None = None) -> FastAPI:
    """Create and configure the FastAPI app for the given config."""
    config = config or MastodonMockConfig.load()

    engine = init_engine(config.database)
    Base.metadata.create_all(engine, checkfirst=True)
    apply_seed_data(engine, config.seed)

    media_path = config.media_storage_path or tempfile.mkdtemp(prefix="mastodon_mock_media_")
    Path(media_path).mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="mastodon_mock", version=config.mocked_version)
    app.state.config = config
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.media_path = media_path

    for module in (
        oauth,
        instance,
        accounts,
        statuses,
        timelines,
        relationships,
        notifications,
        media,
        search,
        lists,
        favourites_bookmarks,
        filters,
        polls,
        preferences,
        conversations,
    ):
        app.include_router(module.router)

    app.mount("/media", StaticFiles(directory=media_path), name="media")

    @app.get("/")
    def root() -> JSONResponse:
        """Trivial health/identity endpoint."""
        return JSONResponse({"mastodon_mock": True, "version": config.mocked_version})

    return app
