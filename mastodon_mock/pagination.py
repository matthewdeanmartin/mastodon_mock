"""Shared pagination helper for list endpoints.

Mastodon.py's ``PaginatableList`` relies on a ``Link`` response header carrying
``max_id``/``min_id`` to drive ``.next()``/``.previous()``. This module applies
``max_id``/``min_id``/``since_id``/``limit`` filters to a query and builds the
``Link`` header. See spec/03-api-coverage.md "Pagination".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import Select, asc, desc
from sqlalchemy.orm import InstrumentedAttribute, Session

DEFAULT_LIMIT = 20
MAX_LIMIT = 40


@dataclass
class Page:
    """Result of a paginated query: the rows plus first/last ids for the Link header."""

    items: list[Any]
    limit: int
    first_id: int | None
    last_id: int | None
    has_more: bool


def paginate(
    session: Session,
    query: Select[Any],
    id_column: InstrumentedAttribute[Any],
    *,
    max_id: str | int | None = None,
    min_id: str | int | None = None,
    since_id: str | int | None = None,
    limit: int | None = None,
    default_limit: int = DEFAULT_LIMIT,
) -> Page:
    """Apply id-cursor pagination to ``query`` and execute it.

    ``min_id`` selects rows *immediately above* the cursor (and reverses sort to
    keep them adjacent), matching Mastodon semantics; ``since_id`` selects rows
    above the cursor but keeps the newest-first ordering.
    """
    eff_limit = default_limit if limit is None else max(1, min(int(limit), MAX_LIMIT))

    if max_id is not None:
        query = query.where(id_column < int(max_id))
    if since_id is not None:
        query = query.where(id_column > int(since_id))

    using_min_id = min_id is not None
    if min_id is not None:
        query = query.where(id_column > int(min_id))
        query = query.order_by(asc(id_column))
    else:
        query = query.order_by(desc(id_column))

    query = query.limit(eff_limit)
    items = list(session.scalars(query).all())

    if using_min_id:
        # Restore newest-first ordering for the caller.
        items.reverse()

    first_id = int(getattr(items[0], id_column.key)) if items else None
    last_id = int(getattr(items[-1], id_column.key)) if items else None
    has_more = len(items) == eff_limit
    return Page(items=items, limit=eff_limit, first_id=first_id, last_id=last_id, has_more=has_more)


def link_header(base_url: str, page: Page, extra_params: dict[str, str] | None = None) -> str | None:
    """Build a ``Link`` header value for a page, or ``None`` if not applicable.

    ``base_url`` should be the absolute request URL path (without query). The
    ``next`` link carries ``max_id=<last_id>``; ``prev`` carries ``min_id=<first_id>``.
    """
    if not page.items:
        return None

    extra = extra_params or {}
    links: list[str] = []

    if page.has_more and page.last_id is not None:
        params = {**extra, "max_id": str(page.last_id), "limit": str(page.limit)}
        links.append(f'<{base_url}?{urlencode(params)}>; rel="next"')

    if page.first_id is not None:
        params = {**extra, "min_id": str(page.first_id), "limit": str(page.limit)}
        links.append(f'<{base_url}?{urlencode(params)}>; rel="prev"')

    return ", ".join(links) if links else None
