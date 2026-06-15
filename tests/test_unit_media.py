"""Unit tests for the pure helpers in ``routers.media``."""

from __future__ import annotations

import pytest

from mastodon_mock.routers.media import _infer_type, _parse_focus


@pytest.mark.parametrize(
    ("mime", "filename", "expected"),
    [
        ("image/png", None, "image"),
        ("image/gif", None, "gifv"),
        ("video/mp4", None, "video"),
        ("audio/mpeg", None, "audio"),
        ("application/octet-stream", None, "unknown"),
        (None, "photo.JPEG", "image"),
        (None, "clip.gif", "gifv"),
        (None, "movie.mov", "video"),
        (None, "song.ogg", "audio"),
        (None, "archive.zip", "unknown"),
        (None, None, "unknown"),
    ],
)
def test_infer_type(mime: str | None, filename: str | None, expected: str) -> None:
    assert _infer_type(mime, filename) == expected


def test_parse_focus_valid() -> None:
    assert _parse_focus("0.5,-0.25") == {"focus": {"x": 0.5, "y": -0.25}}


@pytest.mark.parametrize("focus", ["", None, "not-a-pair", "1.0", "a,b", "1,2,3"])
def test_parse_focus_invalid_returns_empty(focus: str | None) -> None:
    assert not _parse_focus(focus)
