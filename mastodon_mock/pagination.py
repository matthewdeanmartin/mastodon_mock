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


# SQLite stores INTEGERs as signed 64-bit; comparing a column against a Python int
# outside this range raises OverflowError at execute time. IDs never reach these bounds,
# so clamping an out-of-range cursor to the bound is equivalent to (and safer than) the
# unclamped comparison.
_SQLITE_INT_MIN = -(2**63)
_SQLITE_INT_MAX = 2**63 - 1


def clamp_limit(value: int | str | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    """Clamp a client-supplied ``limit`` to ``[1, maximum]``, falling back to ``default``
    for missing/garbage values.

    Used by endpoints that pass ``limit`` straight to ``.limit(...)``: an unbounded value
    (e.g. a fuzzed ``limit=10**40``) otherwise overflows SQLite's 64-bit INTEGER and 500s.
    """
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed, maximum))


def clamp_offset(value: int | str | None) -> int:
    """Clamp a client-supplied ``offset`` to ``[0, 2**63-1]`` (SQLite's INTEGER ceiling).

    Like ``clamp_limit``, this stops a fuzzed/huge ``offset`` from overflowing SQLite when
    passed to ``.offset(...)``. A negative offset is treated as 0.
    """
    if value is None:
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(parsed, _SQLITE_INT_MAX))


def coerce_cursor(value: str | int | None) -> int | None:
    """Parse a cursor query param to an int, ignoring non-numeric junk and clamping to
    SQLite's 64-bit integer range.

    Mastodon ignores an unparsable ``max_id``/``min_id``/``since_id`` rather than
    erroring, so a client (or a fuzzer) sending garbage gets an unfiltered page, not a
    500. ``int(...)`` directly on the raw query string would raise ``ValueError`` on junk
    and the subsequent comparison would raise ``OverflowError`` on a huge-but-valid int.

    Public so endpoints that page in-memory (e.g. conversations) can share the guard.
    """
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(_SQLITE_INT_MIN, min(parsed, _SQLITE_INT_MAX))


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
    try:
        eff_limit = default_limit if limit is None else max(1, min(int(limit), MAX_LIMIT))
    except (TypeError, ValueError):
        eff_limit = default_limit

    max_id_i = coerce_cursor(max_id)
    since_id_i = coerce_cursor(since_id)
    min_id_i = coerce_cursor(min_id)

    if max_id_i is not None:
        query = query.where(id_column < max_id_i)
    if since_id_i is not None:
        query = query.where(id_column > since_id_i)

    using_min_id = min_id_i is not None
    if min_id_i is not None:
        query = query.where(id_column > min_id_i)
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
