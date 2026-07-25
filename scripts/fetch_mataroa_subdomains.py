#!/usr/bin/env python3
"""Fetch and clean the list of *.mataroa.blog subdomains from Certificate Transparency logs.

Mataroa is a blogging platform where every user's blog lives on its own subdomain
(``<username>.mataroa.blog``). There is no public directory, so CT logs (crt.sh) are
the best passive source of discoverable blogs.

The raw crt.sh data is noisy: it contains wildcard entries, internationalized
``xn--`` domains, infrastructure hosts (``status``, ``www``), and a lot of abusive
signups with nested ``git.gitlab.git...`` prefixes. This script pulls those out and
emits a clean, deduplicated, sorted list of real user blog subdomains.

Usage::

    python scripts/fetch_mataroa_subdomains.py           # fetch from crt.sh
    python scripts/fetch_mataroa_subdomains.py raw.json  # process an existing dump

Outputs (in ./data):
    mataroa_subdomains.txt   one <username> per line
    mataroa_subdomains.json  [{"username", "host", "url"}, ...]
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

CRT_URL = "https://crt.sh/?q=%25.mataroa.blog&output=json"
ROOT = "mataroa.blog"

# Infrastructure / non-blog subdomains to exclude.
INFRA = {"www", "status", "beta", "m", "w", "git", "gitlab", "mail", "confluence"}


def fetch(retries: int = 6, delay: int = 8) -> list[dict]:
    """crt.sh is frequently overloaded (502); retry with backoff."""
    req = urllib.request.Request(CRT_URL, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if data[:1] == b"[":
                return json.loads(data)
            print(f"attempt {attempt}: non-JSON response, retrying...", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"attempt {attempt}: {exc}", file=sys.stderr)
        time.sleep(delay)
    raise SystemExit("crt.sh did not return JSON after retries")


def usernames(records: list[dict]) -> set[str]:
    out: set[str] = set()
    for rec in records:
        # name_value can be newline-separated; also consider common_name.
        names = str(rec.get("name_value", "")).split("\n")
        names.append(str(rec.get("common_name", "")))
        for name in names:
            name = name.strip().lower().rstrip(".")
            if not name.endswith("." + ROOT):
                continue
            label = name[: -(len(ROOT) + 1)]  # strip ".mataroa.blog"
            if not label:
                continue
            if "*" in label:  # wildcard cert
                continue
            # The blog owner is the RIGHT-MOST label before ".mataroa.blog".
            # crt.sh entries carry abusive nested prefixes attached to real
            # usernames, e.g. "gitlab.git.gitlab.<user>" or "www.<user>" -> the
            # owner is always the last label. Take it and drop infra/punycode.
            user = label.split(".")[-1]
            if user in INFRA:
                continue
            if user.startswith("xn--"):  # internationalized / punycode spam
                continue
            out.add(user)
    return out


def main() -> None:
    if len(sys.argv) > 1:
        records = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        records = fetch()

    users = sorted(usernames(records))
    data_dir = Path(__file__).resolve().parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    (data_dir / "mataroa_subdomains.txt").write_text(
        "\n".join(users) + "\n", encoding="utf-8"
    )
    rich = [
        {"username": u, "host": f"{u}.{ROOT}", "url": f"https://{u}.{ROOT}/"}
        for u in users
    ]
    (data_dir / "mataroa_subdomains.json").write_text(
        json.dumps(rich, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{len(users)} clean subdomains -> data/mataroa_subdomains.txt / .json")


if __name__ == "__main__":
    main()
