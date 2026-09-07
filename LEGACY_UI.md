# Frozen legacy UI

`ui/` is frozen at `4d981c458abc1d1ed7f2929f33e53a4f8fee1ca8` (2026-09-07).
It remains the bundled mock-server administration and test client. Its source,
lockfile, build targets, and Python packaging are preserved.

New client development belongs in https://github.com/matthewdeanmartin/mawkingbird.
Do not automatically synchronize the two copies.

This repository's `gh-pages` branch continues to host mawkingbird.com. Source
ownership and hosting ownership are separate. The migration runbook is in
`../mawkingbird/MIGRATION.md`. Set `MAWKINGBIRD_PUBLISH_RETIRED=true` at cutover to
retire the old source publishers; drain active runs before enabling new ones.

The two retired deployment workflows are stored in `.github_backup/`, outside
GitHub Actions discovery. Both remote workflows were disabled and the retirement
variable set to true on 2026-09-07; no queued or running Actions runs remained.
To roll back publishing ownership after committing this move, first restore the
files under `.github/workflows/`, then follow the migration rollback sequence.
