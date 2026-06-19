"""Metadata for mastodon_mock."""

__all__ = [
    "__credits__",
    "__dependencies__",
    "__description__",
    "__keywords__",
    "__license__",
    "__readme__",
    "__requires_python__",
    "__status__",
    "__title__",
    "__version__",
]

__title__ = "mastodon_mock"
__version__ = "0.4.0"
__description__ = "Stateful in-memory/SQLite mock of the Mastodon REST API for testing Mastodon clients"
__readme__ = "README.md"
__credits__ = [{"name": "Matthew Martin", "email": "matthewdeanmartin@gmail.com"}]
__keywords__ = ["mastodon", "mock", "fastapi", "testing", "fediverse", "rest-api", "mastodon.py"]
__license__ = "MIT"
__requires_python__ = ">=3.10"
__status__ = "4 - Beta"
__dependencies__ = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic>=2.0.0",
    "python-multipart>=0.0.9",
    "orjson>=3.10.0",
    "tomli>=2.0.1; python_version < '3.11'",
]
