"""Mastodon-shaped error envelopes for every non-2xx JSON response.

Real Mastodon returns ``{"error": "..."}`` (see
https://docs.joinmastodon.org/entities/Error/), and client libraries branch on
that key — Mastodon.py extracts it into its typed exception messages. FastAPI's
defaults leak ``{"detail": ...}`` instead, so a consumer testing error handling
against the mock would exercise a shape a real instance never produces.

These handlers convert every ``HTTPException`` (including Starlette's built-in
404/405 for unrouted paths) and every request-validation failure into the
Mastodon envelope. Routers keep raising ``HTTPException(status_code=...,
detail="message")``; the handler owns the wire shape.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def error_body(detail: Any) -> dict[str, Any]:
    """Build the ``{"error": ...}`` body from an exception detail.

    A dict detail that already carries an ``error`` key passes through, so a
    router can attach Mastodon's occasional extra keys (``error_description``).
    """
    if isinstance(detail, dict) and "error" in detail:
        return detail
    return {"error": detail if isinstance(detail, str) else str(detail)}


def _field_of(err: dict[str, Any]) -> str:
    """The attribute name a pydantic error record points at (sans body/query/path)."""
    parts = [str(piece) for piece in err.get("loc", ()) if piece not in ("body", "query", "path")]
    return ".".join(parts) or "base"


def _summarize_validation_errors(exc: RequestValidationError) -> str:
    """Flatten pydantic error records into Mastodon's one-line prose style."""
    parts: list[str] = []
    for err in exc.errors():
        field = _field_of(err)
        msg = err.get("msg", "is invalid")
        parts.append(f"{field} {msg}" if field != "base" else msg)
    return ", ".join(parts) or "is invalid"


def _validation_details(exc: RequestValidationError) -> dict[str, list[dict[str, str]]]:
    """Mastodon's per-field ``details`` map (see the ValidationError schema):
    ``{attribute: [{"error": CODE, "description": text}, ...]}``."""
    details: dict[str, list[dict[str, str]]] = {}
    for err in exc.errors():
        code = "ERR_BLANK" if err.get("type") == "missing" else "ERR_INVALID"
        details.setdefault(_field_of(err), []).append({"error": code, "description": err.get("msg", "is invalid")})
    return details


async def _http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    # Starlette's stock text for an unrouted path; real Mastodon says
    # "Record not found" for unknown API resources.
    if exc.status_code == 404 and detail == "Not Found":
        detail = "Record not found"
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(detail),
        headers=exc.headers or None,
    )


async def _validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": f"Validation failed: {_summarize_validation_errors(exc)}",
            "details": _validation_details(exc),
        },
    )


def install_error_handlers(app: FastAPI) -> None:
    """Register the Mastodon-envelope handlers on ``app``."""
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)  # type: ignore[arg-type]
