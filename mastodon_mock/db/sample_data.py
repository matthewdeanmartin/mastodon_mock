"""High-performance bulk sample-data generator.

Unlike :mod:`mastodon_mock.db.seed` (find-or-create, one row at a time, fully
idempotent) this module *appends* a throwaway cohort using chunked bulk inserts and
pre-allocated IDs, trading idempotency for speed. See spec/09-sample-data-and-perf.md.
"""

from __future__ import annotations

import contextlib
import random
import secrets
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import Engine, insert
from sqlalchemy.orm import Session

from mastodon_mock.config import SampleDataConfig
from mastodon_mock.db.models import (
    Account,
    Bookmark,
    Favourite,
    Notification,
    OAuthToken,
    Relationship,
    Status,
    StatusTag,
    utcnow,
)
from mastodon_mock.ids import next_id

_DEFAULT_SCOPES = ["read", "write", "follow", "push"]
# Cap on how many generated accounts get a loginable token, so the dev-user list and
# token table don't blow up for huge cohorts.
_TOKEN_CAP = 200

# A small, Zipf-ish hashtag vocabulary so trends/tags ranks meaningfully. Earlier
# entries are weighted more heavily, giving the "Trending" surface a realistic head.
_HASHTAGS = [
    "sample",
    "mastodon",
    "fediverse",
    "introduction",
    "caturday",
    "photography",
    "art",
    "music",
    "coding",
    "opensource",
    "news",
    "books",
    "gardening",
    "coffee",
    "science",
]


@dataclass
class GenerationReport:
    """Per-phase row counts and timings for one generated cohort."""

    accounts: int = 0
    relationships: int = 0
    statuses: int = 0
    favourites: int = 0
    bookmarks: int = 0
    notifications: int = 0
    phase_seconds: dict[str, float] = field(default_factory=dict)
    total_seconds: float = 0.0
    rows_per_second: float = 0.0

    @property
    def total_rows(self) -> int:
        """Total inserted rows across all phases."""
        return (
            self.accounts + self.relationships + self.statuses + self.favourites + self.bookmarks + self.notifications
        )

    def to_dict(self) -> dict[str, object]:
        """JSON-serializable view (used by the CLI ``--json`` and the mock endpoint)."""
        return {
            "accounts": self.accounts,
            "relationships": self.relationships,
            "statuses": self.statuses,
            "favourites": self.favourites,
            "bookmarks": self.bookmarks,
            "notifications": self.notifications,
            "total_rows": self.total_rows,
            "phase_seconds": {k: round(v, 4) for k, v in self.phase_seconds.items()},
            "total_seconds": round(self.total_seconds, 4),
            "rows_per_second": round(self.rows_per_second, 1),
        }


def estimate_rows(cfg: SampleDataConfig) -> int:
    """Rough total row count a config will produce (for warnings/caps)."""
    n = cfg.accounts
    followers = min(cfg.followers_per_account, max(n - 1, 0))
    rows = n  # accounts
    rows += min(n, _TOKEN_CAP)  # tokens
    rows += n * followers * 2  # relationships (directed + mirror)
    statuses = n * cfg.statuses_per_account
    rows += statuses  # statuses
    rows += statuses * 2  # status_tags (up to 2 hashtags per status)
    rows += n * cfg.favourites_per_account
    rows += n * cfg.bookmarks_per_account
    if cfg.with_notifications:
        rows += n * followers  # follow notifications (capped at favourites below)
    return rows


def generate_sample_data(engine: Engine, cfg: SampleDataConfig) -> GenerationReport:
    """Generate and bulk-insert one sample cohort. Appends; not idempotent."""
    rng = random.Random(cfg.seed)  # nosec B311
    report = GenerationReport()
    start = time.perf_counter()

    with _bulk_load_pragmas(engine), Session(engine) as session:
        account_ids = _gen_accounts(session, cfg, rng, report)
        _gen_follows(session, cfg, rng, account_ids, report)
        status_ids = _gen_statuses(session, cfg, rng, account_ids, report)
        _gen_engagement(session, cfg, rng, account_ids, status_ids, report)
        session.commit()

    report.total_seconds = time.perf_counter() - start
    if report.total_seconds > 0:
        report.rows_per_second = report.total_rows / report.total_seconds
    return report


# --- phases -----------------------------------------------------------------------


def _gen_accounts(session: Session, cfg: SampleDataConfig, rng: random.Random, report: GenerationReport) -> list[int]:
    """Bulk-insert accounts + a capped set of loginable tokens. Returns the new IDs."""
    t0 = time.perf_counter()
    now = utcnow()
    suffix = secrets.token_hex(2)
    account_ids = [next_id() for _ in range(cfg.accounts)]

    accounts: list[dict[str, Any]] = [
        {
            "id": aid,
            "username": f"gen_{suffix}_{i}",
            "domain": None,
            "display_name": f"Generated User {i}",
            "note": "",
            "locked": False,
            "bot": False,
            "group": False,
            "indexable": False,
            "created_at": now,
            "fields": [],
            "default_privacy": "public",
            "default_sensitive": False,
            "email": f"gen_{suffix}_{i}@local",
            "role": "user",
            "locale": "en",
            "confirmed": True,
            "approved": True,
            "disabled": False,
            "silenced": False,
            "suspended": False,
            "sensitized": False,
        }
        for i, aid in enumerate(account_ids)
    ]
    _bulk_insert(session, Account, accounts, cfg.chunk_size)
    report.accounts = len(accounts)

    tokens = [
        {
            "id": next_id(),
            "access_token": f"gen_{suffix}_{i}_{secrets.token_hex(8)}",
            "account_id": aid,
            "scopes": list(_DEFAULT_SCOPES),
            "created_at": now,
        }
        for i, aid in enumerate(account_ids[:_TOKEN_CAP])
    ]
    _bulk_insert(session, OAuthToken, tokens, cfg.chunk_size)

    report.phase_seconds["accounts"] = time.perf_counter() - t0
    return account_ids


def _gen_follows(
    session: Session,
    cfg: SampleDataConfig,
    rng: random.Random,
    account_ids: list[int],
    report: GenerationReport,
) -> None:
    """Bulk-insert directed follow edges (+ mirror ``followed_by`` rows)."""
    t0 = time.perf_counter()
    n = len(account_ids)
    k = min(cfg.followers_per_account, max(n - 1, 0))
    if k == 0:
        report.phase_seconds["follows"] = time.perf_counter() - t0
        return

    # Collect edges keyed by (source, target) so the directed row and the mirror
    # followed_by row are merged — accounts can mutually follow, and a mirror can
    # collide with a later forward edge. The unique constraint forbids duplicates.
    edges: dict[tuple[int, int], dict[str, bool]] = {}
    for src in account_ids:
        for tgt in rng.sample(account_ids, k):
            if tgt == src:
                continue
            edges.setdefault((src, tgt), {})["following"] = True
            edges.setdefault((tgt, src), {})["followed_by"] = True

    rows = [
        _rel_row(s, t, following=flags.get("following", False), followed_by=flags.get("followed_by", False))
        for (s, t), flags in edges.items()
    ]
    _bulk_insert(session, Relationship, rows, cfg.chunk_size)

    report.relationships = len(rows)
    report.phase_seconds["follows"] = time.perf_counter() - t0


def _gen_statuses(
    session: Session,
    cfg: SampleDataConfig,
    rng: random.Random,
    account_ids: list[int],
    report: GenerationReport,
) -> list[int]:
    """Bulk-insert statuses; a ``reply_ratio`` fraction reply to an earlier status."""
    t0 = time.perf_counter()
    now = utcnow()
    status_ids: list[int] = []
    rows: list[dict[str, object]] = []
    tag_rows: list[dict[str, object]] = []
    per = cfg.statuses_per_account

    for account_id in account_ids:
        for j in range(per):
            sid = next_id()
            reply_to = None
            if status_ids and rng.random() < cfg.reply_ratio:
                reply_to = rng.choice(status_ids)
            tags = _pick_hashtags(rng)
            tag_text = " ".join(f"#{t}" for t in tags)
            text_body = f"Generated post {j} from account {account_id} {tag_text}"
            for name in tags:
                tag_rows.append({"id": next_id(), "status_id": sid, "name": name})
            rows.append(
                {
                    "id": sid,
                    "account_id": account_id,
                    "content": f"<p>{text_body}</p>",
                    "text": text_body,
                    "created_at": now,
                    "in_reply_to_id": reply_to,
                    "sensitive": False,
                    "spoiler_text": "",
                    "visibility": "public",
                    "quote_state": "accepted",
                    "quote_approval_policy": "public",
                    "edit_history": [],
                }
            )
            status_ids.append(sid)
            if len(rows) >= cfg.chunk_size:
                _bulk_insert(session, Status, rows, cfg.chunk_size)
                rows = []
    if rows:
        _bulk_insert(session, Status, rows, cfg.chunk_size)
    _bulk_insert(session, StatusTag, tag_rows, cfg.chunk_size)

    report.statuses = len(status_ids)
    report.phase_seconds["statuses"] = time.perf_counter() - t0
    return status_ids


def _gen_engagement(
    session: Session,
    cfg: SampleDataConfig,
    rng: random.Random,
    account_ids: list[int],
    status_ids: list[int],
    report: GenerationReport,
) -> None:
    """Bulk-insert favourites/bookmarks (+ optional notifications)."""
    t0 = time.perf_counter()
    if not status_ids:
        report.phase_seconds["engagement"] = time.perf_counter() - t0
        return
    now = utcnow()

    report.favourites = _gen_pairs(
        session, Favourite, account_ids, status_ids, cfg.favourites_per_account, cfg.chunk_size, rng, now
    )
    report.bookmarks = _gen_pairs(
        session, Bookmark, account_ids, status_ids, cfg.bookmarks_per_account, cfg.chunk_size, rng, now
    )

    if cfg.with_notifications and len(account_ids) > 1:
        notifs: list[dict[str, object]] = []
        for account_id in account_ids:
            actor = rng.choice(account_ids)
            if actor == account_id:
                continue
            notifs.append(
                {
                    "id": next_id(),
                    "account_id": account_id,
                    "type": "favourite",
                    "from_account_id": actor,
                    "status_id": rng.choice(status_ids),
                    "created_at": now,
                    "read": False,
                }
            )
        _bulk_insert(session, Notification, notifs, cfg.chunk_size)
        report.notifications = len(notifs)

    report.phase_seconds["engagement"] = time.perf_counter() - t0


def _gen_pairs(
    session: Session,
    model: type,
    account_ids: list[int],
    status_ids: list[int],
    per: int,
    chunk_size: int,
    rng: random.Random,
    now: object,
) -> int:
    """Bulk-insert per-account (account, status) edges, deduped per account."""
    if per <= 0:
        return 0
    rows: list[dict[str, object]] = []
    count = 0
    k = min(per, len(status_ids))
    for account_id in account_ids:
        for status_id in rng.sample(status_ids, k):
            rows.append({"id": next_id(), "account_id": account_id, "status_id": status_id, "created_at": now})
            count += 1
        if len(rows) >= chunk_size:
            _bulk_insert(session, model, rows, chunk_size)
            rows = []
    if rows:
        _bulk_insert(session, model, rows, chunk_size)
    return count


# --- helpers ----------------------------------------------------------------------


def _pick_hashtags(rng: random.Random) -> list[str]:
    """Pick 1–2 distinct hashtags, biased toward the front of ``_HASHTAGS``.

    The triangular weighting gives a few tags much higher usage than the long tail, so
    ``trends/tags`` has a believable ranked head rather than a uniform list.
    """
    count = rng.choice((1, 1, 2))  # mostly one tag, sometimes two
    picked: list[str] = []
    while len(picked) < count:
        # int(triangular(0, n, 0)) skews toward 0 (the most "popular" tags).
        idx = min(int(rng.triangular(0, len(_HASHTAGS), 0)), len(_HASHTAGS) - 1)
        name = _HASHTAGS[idx]
        if name not in picked:
            picked.append(name)
    return picked


def _rel_row(source_id: int, target_id: int, *, following: bool = False, followed_by: bool = False) -> dict[str, Any]:
    """Build a relationships insert row with the default flag set."""
    return {
        "id": next_id(),
        "source_account_id": source_id,
        "target_account_id": target_id,
        "following": following,
        "showing_reblogs": True,
        "notifying": False,
        "followed_by": followed_by,
        "blocking": False,
        "blocked_by": False,
        "muting": False,
        "muting_notifications": True,
        "endorsed": False,
        "requested": False,
        "requested_by": False,
        "note": "",
    }


def _bulk_insert(session: Session, model: Any, rows: list[dict[str, Any]], chunk_size: int) -> None:
    """Insert ``rows`` in ``chunk_size`` batches via Core ``insert()``."""
    if not rows:
        return
    table = model.__table__
    for i in range(0, len(rows), chunk_size):
        session.execute(insert(table), rows[i : i + chunk_size])


@contextlib.contextmanager
def _bulk_load_pragmas(engine: Engine) -> Iterator[None]:
    """Apply SQLite bulk-load PRAGMAs for the duration of the load, then restore."""
    if engine.dialect.name != "sqlite":
        yield
        return
    with engine.connect() as conn:
        prev_sync = conn.exec_driver_sql("PRAGMA synchronous").scalar()
        prev_journal = conn.exec_driver_sql("PRAGMA journal_mode").scalar()
        conn.exec_driver_sql("PRAGMA synchronous = OFF")
        conn.exec_driver_sql("PRAGMA temp_store = MEMORY")
        conn.exec_driver_sql("PRAGMA cache_size = -65536")
        # MEMORY journal for in-memory DBs; WAL is pointless there. File DBs keep WAL.
        if str(engine.url) == "sqlite://":
            conn.exec_driver_sql("PRAGMA journal_mode = MEMORY")
        else:
            conn.exec_driver_sql("PRAGMA journal_mode = WAL")
        conn.commit()
    try:
        yield
    finally:
        with contextlib.suppress(Exception), engine.connect() as conn:
            conn.exec_driver_sql(f"PRAGMA synchronous = {prev_sync}")
            conn.exec_driver_sql(f"PRAGMA journal_mode = {prev_journal}")
            conn.commit()
