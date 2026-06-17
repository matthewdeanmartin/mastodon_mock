"""Deterministic text transforms used by the mock.

The only consumer today is the ``status_translate`` endpoint, which needs a
*visible* transformation so callers can assert that a "translation" differs from
the source text. Pig Latin is deterministic, dependency-free, and obviously
fake — exactly what a test fixture wants. There is no real translation engine.
"""

from __future__ import annotations

import re

_VOWELS = "aeiouAEIOU"
# A run of ASCII letters (and apostrophes inside, e.g. "don't"); everything else
# (whitespace, punctuation, emoji, digits) is passed through untouched.
_WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
# An HTML tag or entity, so we can skip over them when transforming HTML.
_TAG_OR_ENTITY_RE = re.compile(r"<[^>]*>|&[#0-9A-Za-z]+;")


def _match_case(original: str, transformed: str) -> str:
    """Re-apply the original word's casing pattern to the transformed word."""
    if original.isupper() and len(original) > 1:
        return transformed.upper()
    if original[:1].isupper():
        return transformed[:1].upper() + transformed[1:].lower()
    return transformed.lower()


def pig_latin_word(word: str) -> str:
    """Pig-latinize a single alphabetic word, preserving its case pattern.

    Rules: a word starting with a vowel gets ``"way"`` appended; otherwise the
    leading consonant cluster is moved to the end and ``"ay"`` is appended.
    """
    lower = word.lower()
    if lower[0] in _VOWELS.lower():
        result = lower + "way"
    else:
        idx = 0
        while idx < len(lower) and lower[idx] not in _VOWELS.lower():
            idx += 1
        result = lower[idx:] + lower[:idx] + "ay"
    return _match_case(word, result)


def pig_latin_text(text: str) -> str:
    """Pig-latinize the words in a plain-text string, leaving the rest intact."""
    return _WORD_RE.sub(lambda m: pig_latin_word(m.group(0)), text)


def pig_latin_html(html: str) -> str:
    """Pig-latinize the visible text of an HTML fragment, preserving tags/entities.

    Splits the input on HTML tags and entities (which are emitted verbatim) and
    transforms only the text in between, so ``<a href="...">`` attributes and
    ``&amp;`` entities are never mangled.
    """
    out: list[str] = []
    pos = 0
    for m in _TAG_OR_ENTITY_RE.finditer(html):
        out.append(pig_latin_text(html[pos : m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(pig_latin_text(html[pos:]))
    return "".join(out)
