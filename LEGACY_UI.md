# Mock-server UI ownership

`ui/` is the bundled lite administration and test client for `mastodon_mock`.
Mock-focused UI development is welcome here: exercise the REST API, administer
test data, inject faults, and expose library problems.

The client source and lockfile were restored from
`6239b715c77189e3c221ee241c7ab0563e9ec640` (2026-06-22), immediately before
the standalone Mockingbird build was introduced. See `ui/ROLLBACK.md` for the
history, backup, and validation details. This supersedes the September freeze.

Mawkingbird product development and standalone builds belong in
https://github.com/matthewdeanmartin/mawkingbird (`../mawkingbird`).
Do not automatically synchronize the two copies.

The retired deployment workflows remain in `.github_backup/`, outside GitHub
Actions discovery. They were disabled and `MAWKINGBIRD_PUBLISH_RETIRED=true`
was set on 2026-09-07. The sibling repository owns the replacement publishers
and starter-kit consent checks. This rollback does not change remote Pages
settings or delete the existing `gh-pages` branch; hosting migration history
and recovery instructions remain in `../mawkingbird/MIGRATION.md`.
