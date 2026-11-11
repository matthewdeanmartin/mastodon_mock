"""Compare upstream snapshots, including optional parameters and response schemas.

Unlike the mock surface comparison, this compares two versions of the same
upstream contract. Documentation prose is ignored; every structural change is
reported, including changes inside referenced component schemas.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

__all__ = ["main", "schema_changes"]

DOCUMENTATION_KEYS = frozenset({"description", "summary", "example", "examples", "externalDocs", "title"})
NAMED_MAPS = frozenset({"properties", "schemas", "$defs", "definitions", "paths", "responses", "content", "headers"})


def schema_changes(before: Any, after: Any, pointer: str = "") -> list[dict[str, Any]]:
    """Return structural changes with JSON pointers and their before/after values."""
    changes: list[dict[str, Any]] = []
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(before.keys() | after.keys()):
            named_map = pointer.rsplit("/", 1)[-1] in NAMED_MAPS
            if (not named_map and key in DOCUMENTATION_KEYS) or (not pointer and key == "info"):
                continue
            location = pointer + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in before:
                changes.append({"path": location, "kind": "added", "after": after[key]})
            elif key not in after:
                changes.append({"path": location, "kind": "removed", "before": before[key]})
            else:
                changes.extend(schema_changes(before[key], after[key], location))
    elif isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        for index, (old, new) in enumerate(zip(before, after, strict=True)):
            changes.extend(schema_changes(old, new, f"{pointer}/{index}"))
    elif before != after:
        changes.append({"path": pointer, "kind": "changed", "before": before, "after": after})
    return changes


def main() -> None:
    """Write a structural drift report and optionally fail when upstream changes."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("upstream", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    before = json.loads(args.baseline.read_text(encoding="utf-8"))
    after = json.loads(args.upstream.read_text(encoding="utf-8"))
    changes = schema_changes(before, after)
    output = json.dumps({"baseline": before.get("info"), "upstream": after.get("info"), "changes": changes}, indent=2)
    if args.out:
        args.out.write_text(output + "\n", encoding="utf-8")
        print(f"{len(changes)} structural changes; report: {args.out}")
    else:
        print(output)
    if args.strict and changes:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
