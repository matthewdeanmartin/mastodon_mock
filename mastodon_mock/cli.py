"""Command-line entry point for mastodon_mock."""

from __future__ import annotations

import argparse
import json
import sys

import uvicorn

from mastodon_mock.__about__ import __version__
from mastodon_mock.app import create_app
from mastodon_mock.config import PRESETS, MastodonMockConfig, SampleDataConfig


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

    gen = sub.add_parser("gen-data", help="Bulk-generate throwaway sample data")
    gen.add_argument("--config", default=None, help="Path to a .mastodon_mock.toml config file")
    gen.add_argument("--preset", choices=sorted(PRESETS), default=None, help="Named size preset")
    gen.add_argument("--accounts", type=int, default=None)
    gen.add_argument("--statuses-per-account", type=int, default=None)
    gen.add_argument("--followers-per-account", type=int, default=None)
    gen.add_argument("--favourites-per-account", type=int, default=None)
    gen.add_argument("--seed", type=int, default=None, help="RNG seed for a reproducible cohort")
    gen.add_argument("--database", default=None, help="SQLite path to write into (overrides config)")
    gen.add_argument("--in-memory", action="store_true", help="Use an in-memory DB (only useful for a quick benchmark)")
    gen.add_argument("--yes", action="store_true", help="Skip the confirmation prompt for large shapes")
    gen.add_argument("--json", action="store_true", help="Emit the generation report as JSON")

    args = parser.parse_args(argv)

    if args.command == "serve":
        _serve(args)
    elif args.command == "db":
        _db(args)
    elif args.command == "gen-data":
        _gen_data(args)
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


def _gen_data(args: argparse.Namespace) -> None:
    """Generate a sample cohort into the configured database."""
    from mastodon_mock.db.base import Base, init_engine
    from mastodon_mock.db.sample_data import estimate_rows, generate_sample_data

    config = MastodonMockConfig.load(args.config)
    cfg = _build_sample_config(args, config.sample_data)

    if args.in_memory:
        config.database.path = ":memory:"
    elif args.database is not None:
        config.database.path = args.database

    if config.database.path == ":memory:" and not args.in_memory:
        print("Refusing to write into an in-memory DB (it vanishes on exit). Use --in-memory or --database.")
        sys.exit(2)

    rows = estimate_rows(cfg)
    print(f"Target: {cfg.accounts} accounts, ~{rows:,} total rows -> {config.database.path}")
    if rows > 250_000 and not args.yes:
        reply = input("This is a large shape and may be slow. Continue? [y/N] ").strip().lower()
        if reply not in ("y", "yes"):
            print("Aborted.")
            return

    engine = init_engine(config.database)
    Base.metadata.create_all(engine, checkfirst=True)
    report = generate_sample_data(engine, cfg)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
        return
    print(f"\nGenerated in {report.total_seconds:.2f}s ({report.rows_per_second:,.0f} rows/s):")
    print(f"  accounts:      {report.accounts:>10,}")
    print(f"  relationships: {report.relationships:>10,}")
    print(f"  statuses:      {report.statuses:>10,}")
    print(f"  favourites:    {report.favourites:>10,}")
    print(f"  bookmarks:     {report.bookmarks:>10,}")
    print(f"  notifications: {report.notifications:>10,}")
    print(f"  total rows:    {report.total_rows:>10,}")


def _build_sample_config(args: argparse.Namespace, default: SampleDataConfig) -> SampleDataConfig:
    """Merge CLI flags over a preset (or the configured default)."""
    base = PRESETS[args.preset] if args.preset else default
    overrides = {
        "accounts": args.accounts,
        "statuses_per_account": args.statuses_per_account,
        "followers_per_account": args.followers_per_account,
        "favourites_per_account": args.favourites_per_account,
        "seed": args.seed,
    }
    data = base.model_dump()
    data.update({k: v for k, v in overrides.items() if v is not None})
    return SampleDataConfig.model_validate(data)


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
