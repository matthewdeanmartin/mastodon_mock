"""Small router helpers: pagination param parsing and Link headers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Request, Response

from mastodon_mock.pagination import Page, link_header


async def read_body(request: Request) -> dict[str, Any]:
    """Read request params from a JSON or form body (Mastodon.py uses both).

    Repeated form keys (``name[]=a&name[]=b``) collapse to a list under ``name``.
    Returns an empty dict for an empty/unparseable body.
    """
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            data = await request.json()
        except Exception:
            return {}
        return dict(data) if isinstance(data, dict) else {}
    out: dict[str, Any] = {}
    try:
        form = await request.form()
    except Exception:
        return out
    for key in form:
        bare = key[:-2] if key.endswith("[]") else key
        values = form.getlist(key)
        out[bare] = values if (len(values) > 1 or key.endswith("[]")) else values[0]
    return out


def truthy(value: Any) -> bool:
    """Coerce a form string (``"true"``/``"on"``/``"1"``) or JSON bool to ``bool``."""
    if isinstance(value, bool):
        return value
    return str(value).lower() in ("true", "1", "on")


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


def array_query(request: Request, name: str) -> list[str]:
    """Read a repeatable query param under both ``name`` and ``name[]``.

    Mastodon.py serializes list arguments as ``name[]=a&name[]=b`` (see
    ``Mastodon.__generate_params``), so a plain ``name`` FastAPI ``Query`` binding
    would silently drop the values. Reading both keeps bulk-by-id endpoints honest.
    """
    qp = request.query_params
    values = list(qp.getlist(name)) + list(qp.getlist(f"{name}[]"))
    return [v for v in values if v]
