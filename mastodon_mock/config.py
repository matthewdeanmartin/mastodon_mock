"""Configuration loading for mastodon_mock.

Loads from ``.mastodon_mock.toml`` (whole document) or the
``[tool.mastodon_mock]`` table of ``pyproject.toml``, falling back to built-in
defaults. See spec/01-architecture.md.
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from mastodon_mock.versioning import CURRENT_VERSION


class DatabaseConfig(BaseModel):
    """SQLite database settings."""

    driver: str = "sqlite"
    path: str = ":memory:"
    echo: bool = False


class ServerConfig(BaseModel):
    """uvicorn host/port settings for ``mastodon_mock serve``."""

    host: str = "127.0.0.1"
    port: int = 3000


class AuthConfig(BaseModel):
    """Auth behaviour knobs."""

    # If true, any/no bearer token maps to the first seeded account.
    permissive: bool = False
    # If true, enforce coarse OAuth scopes (read/write/follow) on the token.
    # Off by default — the mock stores+echoes scopes but does not check them.
    enforce_scopes: bool = False


class RateLimitConfig(BaseModel):
    """Opt-in rate limiting (off by default).

    When ``enabled``, the mock returns ``429`` + ``X-RateLimit-*`` headers after
    ``limit`` requests within ``window_seconds``, so consuming suites can exercise
    Mastodon.py's ``ratelimit_method`` handling. A documented stretch goal.
    """

    enabled: bool = False
    limit: int = 300
    window_seconds: int = 300


class SeedAccount(BaseModel):
    """A single seeded account."""

    username: str
    domain: str | None = None
    display_name: str | None = None
    note: str | None = None
    locked: bool = False
    bot: bool = False
    access_token: str | None = None


class SeedFollow(BaseModel):
    """A seeded follow edge by username."""

    follower: str
    following: str


class SeedStatus(BaseModel):
    """A seeded status by account username."""

    account: str
    text: str
    visibility: str = "public"


class SeedConfig(BaseModel):
    """The collection of seed data."""

    accounts: list[SeedAccount] = Field(default_factory=list)
    follows: list[SeedFollow] = Field(default_factory=list)
    statuses: list[SeedStatus] = Field(default_factory=list)


# mock seed token below is not a real credential
DEFAULT_SEED = SeedConfig(
    accounts=[SeedAccount(username="testuser", display_name="Test User", access_token="mock_token")],  # nosec B106
)


class MastodonMockConfig(BaseModel):
    """Top-level configuration object."""

    mocked_version: str = CURRENT_VERSION
    domain: str = "mock.local"
    title: str = "Mastodon Mock"
    email: str = "admin@mock.local"
    description: str = "A local mock Mastodon instance for testing."
    media_storage_path: str | None = None
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    ratelimit: RateLimitConfig = Field(default_factory=RateLimitConfig)
    seed: SeedConfig = Field(default_factory=lambda: DEFAULT_SEED)
    rules: list[str] = Field(default_factory=list)

    @classmethod
    def load(cls, config_path: str | Path | None = None) -> MastodonMockConfig:
        """Load configuration following the precedence in spec/01-architecture.md.

        1. An explicit ``config_path`` (or ``./.mastodon_mock.toml``) → whole document.
        2. ``[tool.mastodon_mock]`` in ``./pyproject.toml``.
        3. Built-in defaults.
        """
        data: dict[str, Any] | None = None

        if config_path is not None:
            data = _read_toml(Path(config_path))
        else:
            local = Path.cwd() / ".mastodon_mock.toml"
            if local.is_file():
                data = _read_toml(local)
            else:
                pyproject = Path.cwd() / "pyproject.toml"
                if pyproject.is_file():
                    doc = _read_toml(pyproject)
                    data = doc.get("tool", {}).get("mastodon_mock")

        if not data:
            return cls()
        return cls.model_validate(data)


def _read_toml(path: Path) -> dict[str, Any]:
    """Read and parse a TOML file."""
    with path.open("rb") as fh:
        return tomllib.load(fh)
