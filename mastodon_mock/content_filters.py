"""Apply a viewer's persisted Mastodon content filters to statuses."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from mastodon_mock.db.models import Account, Filter, Status, utcnow
from mastodon_mock.serializers.misc import serialize_filter_v2

_HTML_RE = re.compile(r"<[^>]*>")


@dataclass(frozen=True)
class FilterMatch:
    """The serialized matches for one filter and whether it hides the status."""

    result: dict[str, object]
    hides: bool


def matches_for_status(
    session: Session,
    status: Status,
    viewer: Account | None,
    context: str | None,
) -> list[FilterMatch]:
    """Return active filters matching ``status`` for ``viewer`` in ``context``."""
    if viewer is None or context is None:
        return []
    effective = session.get(Status, status.reblog_of_id) if status.reblog_of_id is not None else status
    if effective is None:
        effective = status
    filters = session.scalars(select(Filter).where(Filter.account_id == viewer.id)).all()
    now = utcnow()
    haystack = f"{_HTML_RE.sub('', effective.content or '')}\n{effective.spoiler_text or ''}"
    matches: list[FilterMatch] = []
    for filt in filters:
        if context not in (filt.context or []):
            continue
        if filt.expires_at is not None:
            expires_at = filt.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= now:
                continue
        keyword_matches = [
            keyword.keyword
            for keyword in filt.keywords
            if _keyword_matches(haystack, keyword.keyword, keyword.whole_word)
        ]
        status_matches = [str(item.status_id) for item in filt.status_filters if item.status_id == effective.id]
        if not keyword_matches and not status_matches:
            continue
        matches.append(
            FilterMatch(
                result={
                    "filter": serialize_filter_v2(filt),
                    "keyword_matches": keyword_matches or None,
                    "status_matches": status_matches or None,
                },
                hides=filt.filter_action == "hide",
            )
        )
    return matches


def _keyword_matches(text: str, keyword: str, whole_word: bool) -> bool:
    if not keyword:
        return False
    if not whole_word:
        return keyword.casefold() in text.casefold()
    return re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", text, flags=re.IGNORECASE) is not None
