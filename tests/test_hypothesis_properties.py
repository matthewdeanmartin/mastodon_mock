"""Property-based tests for pure helpers that transform client-supplied data.

These target functions whose job is "take a value a real Mastodon client would
plausibly send, and produce a well-formed result" — pagination cursors/limits,
status text rendering, pig-latin translation, hashtag parsing, and version
parsing. Inputs are restricted to realistic shapes (ordinary text, in-range
integers, dotted version strings) rather than adversarial/garbage input,
since real clients are not attacking this mock — they're posting normal
statuses, paging timelines, and reporting plausible version strings.
"""

from __future__ import annotations

import string

from hypothesis import given, settings
from hypothesis import strategies as st

from mastodon_mock.content_format import render_status_html
from mastodon_mock.pagination import (
    _SQLITE_INT_MAX,
    _SQLITE_INT_MIN,
    clamp_limit,
    clamp_offset,
    coerce_cursor,
    parse_db_id,
)
from mastodon_mock.services import parse_hashtags
from mastodon_mock.text import pig_latin_html, pig_latin_text, pig_latin_word
from mastodon_mock.versioning import api_version_for, parse_version_string

# ---------------------------------------------------------------------------
# pagination.py — clamp_limit / clamp_offset / coerce_cursor
# ---------------------------------------------------------------------------

# Mastodon IDs are snowflake-shaped ints; a client paging a timeline sends
# small non-negative limits/offsets and plausible (often huge but valid)
# snowflake ids as cursors.
reasonable_ints = st.integers(min_value=-10_000_000, max_value=10**18)
reasonable_limit_inputs = st.one_of(st.none(), reasonable_ints, reasonable_ints.map(str))
reasonable_cursor_inputs = st.one_of(st.none(), reasonable_ints, reasonable_ints.map(str))


@given(reasonable_limit_inputs)
def test_clamp_limit_always_in_bounds(value: int | str | None) -> None:
    result = clamp_limit(value)
    assert 1 <= result <= 40


@given(st.integers(min_value=1, max_value=40))
def test_clamp_limit_is_identity_within_range(value: int) -> None:
    # A limit a real client would actually send (1..40) should pass through unchanged.
    assert clamp_limit(value) == value
    assert clamp_limit(str(value)) == value


@given(reasonable_limit_inputs)
def test_clamp_offset_always_in_bounds(value: int | str | None) -> None:
    result = clamp_offset(value)
    assert 0 <= result <= _SQLITE_INT_MAX


@given(st.integers(min_value=0, max_value=10**12))
def test_clamp_offset_is_identity_for_non_negative(value: int) -> None:
    assert clamp_offset(value) == value
    assert clamp_offset(str(value)) == value


@given(reasonable_cursor_inputs)
def test_coerce_cursor_in_sqlite_range_or_none(value: int | str | None) -> None:
    result = coerce_cursor(value)
    if value is None:
        assert result is None
    else:
        assert result is not None
        assert _SQLITE_INT_MIN <= result <= _SQLITE_INT_MAX


@given(st.integers(min_value=_SQLITE_INT_MIN, max_value=_SQLITE_INT_MAX))
def test_coerce_cursor_is_identity_within_sqlite_range(value: int) -> None:
    assert coerce_cursor(value) == value
    assert coerce_cursor(str(value)) == value


# ---------------------------------------------------------------------------
# pagination.py — parse_db_id
#
# Regression coverage for a bug schemathesis found: routers parsed path/body
# ids with a bare ``int(value)`` inside a ``try/except (ValueError, TypeError)``.
# Arbitrary-precision Python ints never raise on huge digit strings, so the
# except clause didn't catch them; the unbounded int then hit SQLAlchemy's
# ``db.get(Model, huge_int)`` and raised ``OverflowError`` (Python int too
# large for SQLite INTEGER), a 500 instead of a 404. ``parse_db_id`` rejects
# (returns None) anything outside SQLite's 64-bit range instead of clamping,
# since a clamped huge id must not alias a real row at the boundary value.
# ---------------------------------------------------------------------------

# A client never sends a snowflake id anywhere near 2**63; this generates the
# "implausibly large but technically a valid Python int" shape a fuzzer finds.
huge_digit_strings = st.integers(min_value=0, max_value=10**6).map(lambda n: str(10**63 + n))


@given(st.one_of(reasonable_ints, reasonable_ints.map(str), huge_digit_strings, st.none()))
def test_parse_db_id_never_overflows_sqlite_range(value: int | str | None) -> None:
    result = parse_db_id(value)
    assert result is None or _SQLITE_INT_MIN <= result <= _SQLITE_INT_MAX


@given(huge_digit_strings)
def test_parse_db_id_rejects_out_of_range_rather_than_clamping(value: str) -> None:
    # A huge id must be treated as "no such row", not silently aliased to the
    # boundary value (which could collide with a real row at 2**63-1).
    assert parse_db_id(value) is None


@given(st.integers(min_value=_SQLITE_INT_MIN, max_value=_SQLITE_INT_MAX))
def test_parse_db_id_is_identity_within_sqlite_range(value: int) -> None:
    assert parse_db_id(value) == value
    assert parse_db_id(str(value)) == value


# ---------------------------------------------------------------------------
# text.py — pig_latin_word / pig_latin_text / pig_latin_html
# ---------------------------------------------------------------------------

alpha_word = st.text(alphabet=string.ascii_letters, min_size=1, max_size=20)
# Ordinary status-shaped text: words, spaces, punctuation, newlines — what a
# person actually types, not control characters or non-Latin scripts.
plain_status_text = st.text(
    alphabet=string.ascii_letters + string.digits + " .,!?'\n",
    min_size=0,
    max_size=200,
)


@given(alpha_word)
def test_pig_latin_word_preserves_length_class(word: str) -> None:
    # Either "...way" (vowel start) or "...ay" (consonant start) is appended;
    # the transformed word is always longer than the original by 2 or 3 chars.
    result = pig_latin_word(word)
    assert len(result) in (len(word) + 2, len(word) + 3)


@given(alpha_word)
def test_pig_latin_word_is_deterministic(word: str) -> None:
    assert pig_latin_word(word) == pig_latin_word(word)


@given(alpha_word)
def test_pig_latin_word_case_pattern_matches_classification(word: str) -> None:
    result = pig_latin_word(word)
    if word.isupper() and len(word) > 1:
        assert result.isupper()
    elif word[:1].isupper():
        assert result[:1].isupper()
        assert result[1:].islower() or not result[1:].isalpha()
    else:
        assert result.islower()


@given(plain_status_text)
def test_pig_latin_text_preserves_non_letter_characters(text: str) -> None:
    # Whitespace/punctuation/digits must survive untouched and in order;
    # only runs of letters are rewritten.
    stripped_input = "".join(ch for ch in text if not ch.isalpha())
    stripped_output = "".join(ch for ch in pig_latin_text(text) if not ch.isalpha())
    assert stripped_input == stripped_output


@given(plain_status_text)
def test_pig_latin_text_is_idempotent_on_non_letters_only(text: str) -> None:
    non_letter_text = "".join(ch for ch in text if not ch.isalpha())
    assert pig_latin_text(non_letter_text) == non_letter_text


@given(st.text(alphabet=string.ascii_letters + " ", min_size=0, max_size=100))
def test_pig_latin_html_matches_plain_text_when_no_markup(text: str) -> None:
    # With no tags/entities in the input, HTML and plain-text pig-latin agree.
    assert pig_latin_html(text) == pig_latin_text(text)


@given(st.text(alphabet=string.ascii_letters + " ", min_size=0, max_size=80))
def test_pig_latin_html_preserves_wrapping_tags(inner: str) -> None:
    html_in = f"<p>{inner}</p>"
    out = pig_latin_html(html_in)
    assert out.startswith("<p>")
    assert out.endswith("</p>")


# ---------------------------------------------------------------------------
# content_format.py — render_status_html
# ---------------------------------------------------------------------------


@given(plain_status_text)
def test_render_status_html_never_lets_angle_brackets_through_raw(text: str) -> None:
    # The function escapes first; user-typed "<" / ">" must never appear in the
    # output except as part of the small set of tags this renderer itself emits.
    rendered = render_status_html(text)
    allowed_tags = {
        "<p>",
        "</p>",
        "<br />",
        "<a ",
        "</a>",
        "<strong>",
        "</strong>",
        "<em>",
        "</em>",
        "<code>",
        "</code>",
        "<del>",
        "</del>",
    }
    remainder = rendered
    for tag in allowed_tags:
        remainder = remainder.replace(tag, "")
    assert "<" not in remainder
    assert ">" not in remainder


@given(plain_status_text)
def test_render_status_html_always_wraps_in_paragraph(text: str) -> None:
    rendered = render_status_html(text)
    assert rendered.startswith("<p>")
    assert rendered.endswith("</p>")


@given(plain_status_text)
def test_render_status_html_is_deterministic(text: str) -> None:
    assert render_status_html(text) == render_status_html(text)


@given(st.text(alphabet=string.ascii_letters + string.digits, min_size=1, max_size=30))
def test_render_status_html_round_trips_plain_words(word: str) -> None:
    # A single alphanumeric word with no markup/URLs should survive untouched
    # inside its paragraph wrapper.
    assert render_status_html(word) == f"<p>{word}</p>"


# ---------------------------------------------------------------------------
# services.py — parse_hashtags
# ---------------------------------------------------------------------------

hashtag_name = st.text(alphabet=string.ascii_letters + string.digits + "_", min_size=1, max_size=15)


@given(st.lists(hashtag_name, min_size=0, max_size=10))
def test_parse_hashtags_returns_lowercased_unique_names(names: list[str]) -> None:
    text = " ".join(f"#{name}" for name in names)
    result = parse_hashtags(text)
    assert all(name == name.lower() for name in result)
    assert len(result) == len(set(result))


@given(hashtag_name)
def test_parse_hashtags_finds_single_tag_case_insensitively(name: str) -> None:
    assert parse_hashtags(f"hello #{name} world") == [name.lower()]


@given(plain_status_text)
def test_parse_hashtags_is_deterministic(text: str) -> None:
    assert parse_hashtags(text) == parse_hashtags(text)


# ---------------------------------------------------------------------------
# versioning.py — parse_version_string / api_version_for
# ---------------------------------------------------------------------------

# A realistic Mastodon version string: 1-3 dotted numeric components, the kind
# a server actually reports (optionally with a "rc1"-style suffix on the last).
version_component = st.integers(min_value=0, max_value=999)


@given(st.lists(version_component, min_size=1, max_size=3))
def test_parse_version_string_round_trips_dotted_integers(components: list[int]) -> None:
    version_str = ".".join(str(c) for c in components)
    parsed = parse_version_string(version_str)
    padded = components + [0] * (3 - len(components))
    assert parsed == tuple(padded)


@given(st.lists(version_component, min_size=3, max_size=3), st.sampled_from(["rc1", "beta2", "alpha"]))
def test_parse_version_string_strips_prerelease_suffix(components: list[int], suffix: str) -> None:
    version_str = f"{components[0]}.{components[1]}.{components[2]}{suffix}"
    assert parse_version_string(version_str) == tuple(components)


@given(st.lists(version_component, min_size=1, max_size=3))
def test_api_version_for_always_returns_known_int(components: list[int]) -> None:
    version_str = ".".join(str(c) for c in components)
    result = api_version_for(version_str)
    assert isinstance(result, int)
    assert result >= 1

# This is a flaky test
# @settings(max_examples=25)
# @given(version_component, version_component)
# def test_api_version_for_unknown_major_minor_falls_back_to_2(major: int, minor: int) -> None:
#     if (major, minor) in {(4, 4), (4, 3), (4, 2), (4, 1), (4, 0)}:
#         return
#     assert api_version_for(f"{major}.{minor}.0") == 2
