"""Deterministic SVG identicons used as avatar/header placeholders.

Real Mastodon ships stock placeholder images; this mock instead renders a small
colored SVG per account (keyed by ``acct``) so seeded/generated accounts are
visually distinguishable in the UI instead of all showing the same blank image.
"""

from __future__ import annotations

import hashlib

_PALETTE = [
    "#6b5b95", "#feb236", "#d64161", "#ff7b25", "#45b8ac",
    "#5b9aa0", "#d6cbd3", "#eca1a6", "#bdcebe", "#9cc4c3",
    "#e9d2a3", "#a8e6cf", "#dcedc1", "#ffaaa5", "#ff8b94",
]


def _color_and_letter(seed: str) -> tuple[str, str]:
    """Pick a deterministic palette color and initial letter for ``seed``."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    color = _PALETTE[digest[0] % len(_PALETTE)]
    letter = next((c for c in seed if c.isalnum()), "?").upper()
    return color, letter


def avatar_svg(seed: str) -> str:
    """Render a square identicon: a solid color tile with the account's initial."""
    color, letter = _color_and_letter(seed)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">'
        f'<rect width="120" height="120" fill="{color}"/>'
        f'<text x="60" y="78" font-size="56" font-family="sans-serif" fill="white" '
        f'text-anchor="middle">{letter}</text>'
        "</svg>"
    )


def header_svg(seed: str) -> str:
    """Render a wide banner identicon for use as a profile header image."""
    color, letter = _color_and_letter(seed + ":header")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">'
        f'<rect width="600" height="200" fill="{color}"/>'
        f'<text x="300" y="125" font-size="48" font-family="sans-serif" fill="white" '
        f'text-anchor="middle" opacity="0.6">{letter}</text>'
        "</svg>"
    )
