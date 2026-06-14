"""Small router helpers: pagination param parsing and Link headers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response

from mastodon_mock.pagination import Page, link_header


@dataclass
class PageParams:
    """Parsed pagination query params."""

    max_id: str | None = None
    min_id: str | None = None
    since_id: str | None = None
    limit: int | None = None


def _page_params(
    max_id: str | None = None,
    min_id: str | None = None,
    since_id: str | None = None,
    limit: int | None = None,
) -> PageParams:
    """FastAPI dependency collecting standard pagination query params."""
    return PageParams(max_id=max_id, min_id=min_id, since_id=since_id, limit=limit)


# Importable dependency annotation used across list endpoints.
PageQuery = Annotated[PageParams, Depends(_page_params)]


def set_link_header(
    request: Request,
    response: Response,
    page: Page,
    extra_params: dict[str, str] | None = None,
) -> None:
    """Attach a ``Link`` header for ``page`` to ``response`` if applicable."""
    base = f"{request.url.scheme}://{request.url.netloc}{request.url.path}"
    header = link_header(base, page, extra_params)
    if header:
        response.headers["Link"] = header
