"""Command-line entry point for mastodon_mock."""

from __future__ import annotations

import argparse

import uvicorn

from mastodon_mock.__about__ import __version__
from mastodon_mock.app import create_app
from mastodon_mock.config import MastodonMockConfig


def main(argv: list[str] | None = None) -> None:
    """Run the mastodon_mock CLI."""
    parser = argparse.ArgumentParser(
        prog="mastodon_mock",
        description="Stateful Mastodon mock server.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="Run the mock HTTP server")
    serve.add_argument("--config", default=None, help="Path to a .mastodon_mock.toml config file")
    serve.add_argument("--host", default=None, help="Host to bind (overrides config)")
    serve.add_argument("--port", type=int, default=None, help="Port to bind (overrides config)")
    serve.add_argument("--in-memory", action="store_true", help="Force in-memory SQLite")

    upgrade = sub.add_parser("db", help="Database commands")
    upgrade.add_argument("db_command", choices=["upgrade"], help="Database subcommand")
    upgrade.add_argument("--config", default=None)

    args = parser.parse_args(argv)

    if args.command == "serve":
        _serve(args)
    elif args.command == "db":
        _db(args)
    else:
        parser.print_help()


def _serve(args: argparse.Namespace) -> None:
    """Run the uvicorn server with the resolved config."""
    config = MastodonMockConfig.load(args.config)
    if args.in_memory:
        config.database.path = ":memory:"
    host = args.host or config.server.host
    port = args.port or config.server.port
    app = create_app(config)
    uvicorn.run(app, host=host, port=port)


def _db(args: argparse.Namespace) -> None:
    """Run a database management command (alembic upgrade head)."""
    if args.db_command == "upgrade":
        from alembic import command
        from alembic.config import Config as AlembicConfig

        cfg = AlembicConfig("alembic.ini")
        command.upgrade(cfg, "head")
        print("Database upgraded to head.")


if __name__ == "__main__":
    main()
