"""Mastodon version awareness ("current and current-1").

See spec/05-versioning.md. The mock pins two version strings and derives the
integer ``api_versions.mastodon`` value from the major.minor line.
"""

from __future__ import annotations

# The newest Mastodon release the mock has been validated against.
CURRENT_VERSION = "4.4.4"
# The previous minor line, exercised in the test matrix.
PREVIOUS_VERSION = "4.3.9"

# api_versions.mastodon integer per major.minor line (Mastodon introduced API
# versioning in 4.3). Update when bumping the pinned versions.
API_VERSION_BY_MASTODON_VERSION: dict[tuple[int, int], int] = {
    (4, 4): 2,
    (4, 3): 2,
    (4, 2): 1,
    (4, 1): 1,
    (4, 0): 1,
}


def parse_version_string(version: str) -> tuple[int, int, int]:
    """Parse a ``"major.minor.patch"`` string into a 3-tuple of ints.

    Trailing non-numeric suffixes (e.g. ``"4.4.0rc1"``) are tolerated by
    stripping to the leading integer of each component. Missing components
    default to 0.
    """
    parts = version.split(".")
    nums: list[int] = []
    for part in parts[:3]:
        digits = ""
        for ch in part:
            if ch.isdigit():
                digits += ch
            else:
                break
        nums.append(int(digits) if digits else 0)
    while len(nums) < 3:
        nums.append(0)
    return nums[0], nums[1], nums[2]


def api_version_for(mocked_version: str) -> int:
    """Return the integer ``api_versions.mastodon`` value for a version string."""
    major, minor, _ = parse_version_string(mocked_version)
    return API_VERSION_BY_MASTODON_VERSION.get((major, minor), 2)
