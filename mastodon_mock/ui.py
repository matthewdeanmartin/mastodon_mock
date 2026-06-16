"""Serve the bundled Angular admin panel / client UI at ``/_ui/``.

The built bundle lives in ``mastodon_mock/_ui_dist/browser`` and is produced by the
Angular build (``make ui`` locally, or the packaging build hook). When it is absent —
e.g. an editable install that never ran a UI build — the mount is skipped and the
server still boots; ``GET /`` simply omits its ``ui`` pointer.

See spec/08-admin-ui.md.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import Scope

logger = logging.getLogger(__name__)

# The Angular @angular/build:application builder emits into a ``browser`` subdir.
_UI_DIR = Path(__file__).parent / "_ui_dist" / "browser"


def ui_dist_dir() -> Path:
    """The directory the built UI is served from."""
    return _UI_DIR


class _SpaStaticFiles(StaticFiles):
    """StaticFiles that falls back to ``index.html`` for unknown paths (SPA deep links).

    A request like ``/_ui/statuses/123`` has no matching file on disk; rather than 404,
    serve ``index.html`` so the Angular router can handle the route client-side. Real
    asset requests still resolve to their files.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def mount_ui(app: FastAPI) -> bool:
    """Mount the SPA at ``/_ui/`` if it has been built. Return whether it was mounted."""
    if not (_UI_DIR / "index.html").is_file():
        logger.info(
            "Admin UI not built (no %s); skipping /_ui/ mount. Run `make ui` to build it.",
            _UI_DIR / "index.html",
        )
        return False

    # Bare "/_ui" → "/_ui/" so the SPA's base href ("/_ui/") and relative assets resolve.
    @app.get("/_ui")
    def _ui_redirect() -> RedirectResponse:
        return RedirectResponse(url="/_ui/")

    app.mount("/_ui", _SpaStaticFiles(directory=_UI_DIR, html=True), name="ui")
    logger.info("Admin UI mounted at /_ui/ from %s", _UI_DIR)
    return True
