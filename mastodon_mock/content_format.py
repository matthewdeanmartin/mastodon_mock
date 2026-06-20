"""Render plain status text into safe HTML, the way a real Mastodon server would.

Real instances store ``content`` as server-rendered HTML: user text is escaped,
bare URLs become ``<a>`` links, and a light subset of emphasis markup is honored.
Clients (including this mock's own UI) trust and display that HTML as-is via
``innerHTML``, so all escaping/formatting must happen here, once, server-side.
"""

from __future__ import annotations

import html
import re

_URL_RE = re.compile(r"(https?://[^\s<>\"]+)")
_BOLD_RE = re.compile(r"\*\*(?!\s)(.+?)(?<!\s)\*\*")
_STRIKE_RE = re.compile(r"~~(?!\s)(.+?)(?<!\s)~~")
_CODE_RE = re.compile(r"`([^`]+)`")
_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)")


def render_status_html(text: str) -> str:
    """Convert raw status text into safe paragraph HTML with links and light markdown.

    Escapes HTML first so user input can never inject markup, then layers on
    bare-URL linkification and ``**bold**``/``*italic*``/`` `code` ``/``~~strike~~``
    spans, then wraps blank-line-separated blocks in ``<p>``.
    """
    escaped = html.escape(text, quote=False)

    def _linkify(line: str) -> str:
        return _URL_RE.sub(lambda m: f'<a href="{m.group(1)}" rel="nofollow noopener" target="_blank">{m.group(1)}</a>', line)

    def _emphasize(line: str) -> str:
        line = _CODE_RE.sub(r"<code>\1</code>", line)
        line = _BOLD_RE.sub(r"<strong>\1</strong>", line)
        line = _STRIKE_RE.sub(r"<del>\1</del>", line)
        line = _ITALIC_RE.sub(r"<em>\1</em>", line)
        return line

    paragraphs = re.split(r"\n\s*\n", escaped.strip())
    rendered = []
    for para in paragraphs:
        if not para:
            continue
        lines = [_emphasize(_linkify(line)) for line in para.split("\n")]
        rendered.append(f"<p>{'<br />'.join(lines)}</p>")

    return "".join(rendered) if rendered else "<p></p>"
