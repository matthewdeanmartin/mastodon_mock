#!/usr/bin/env python
"""Resize a source logo to the 104x104 @2x asset used in the top bar and login hero.

The UI displays the brand mark at 36-52 CSS px; the checked-in *_104.png files are
the 104px retina sources (e.g. mockigbird_logo.png -> mockigbird_logo_104.png).

Usage (from repo root, needs Pillow):
    uv run --with pillow python ui/scripts/resize_logo.py ui/public/canary_logo.png
    uv run --with pillow python ui/scripts/resize_logo.py ui/public/canary_logo.png --size 104

By default it writes alongside the source with a _<size> suffix.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

SIZE = 104


def resize(src: Path, size: int, out: Path | None) -> Path:
    if out is None:
        out = src.with_name(f"{src.stem}_{size}{src.suffix}")
    img = Image.open(src).convert("RGBA")
    img = img.resize((size, size), Image.LANCZOS)
    img.save(out)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="source logo image")
    parser.add_argument("--size", type=int, default=SIZE, help="square edge in px (default 104)")
    parser.add_argument("--out", type=Path, default=None, help="output path (default: <name>_<size>.png)")
    args = parser.parse_args()

    out = resize(args.source, args.size, args.out)
    with Image.open(out) as done:
        print(f"Wrote {out} ({done.size[0]}x{done.size[1]} {done.mode})")


if __name__ == "__main__":
    main()
