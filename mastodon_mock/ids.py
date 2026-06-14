"""Snowflake-ish ID generation.

Mastodon IDs are stringified, monotonically-increasing integers. We seed a
counter from the current epoch milliseconds so IDs sort correctly and look
plausible, and bump it on every call so concurrent inserts within a process
never collide.
"""

from __future__ import annotations

import itertools
import threading
import time

_lock = threading.Lock()
# Start from epoch-ms so values look like real snowflakes and sort by time.
_counter = itertools.count(int(time.time() * 1000))


def next_id() -> int:
    """Return the next monotonically-increasing ID as an int."""
    with _lock:
        return next(_counter)
