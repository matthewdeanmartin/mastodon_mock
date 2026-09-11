# Release readiness sprint — September 2026

Baseline: `a864a7231`. Keep the bundled lite UI and all Python improvements.
Standalone Mawkingbird belongs in `../mawkingbird`. Do not publish during this sprint.

## Confirmed issues and acceptance criteria

- [x] Database upgrades work from an installed wheel outside the checkout, use
  `--config`, preserve existing data, and reject ephemeral migration targets.
- [x] The HTTP demo emits reachable asset URLs; HTTPS and explicit proxy settings
  remain supported. Cover generated avatars, headers, and streaming discovery.
- [x] Metadata sync and version checks pass.
- [x] The strict documentation build passes. Correct root-response and trend
  behavior, explain source-build requirements, and remove stale product guidance.
- [x] Root and docs changelogs agree and validation uses the release workflow's
  current changelog tool.
- [x] Local checks run on Windows without POSIX-only filtering or recipe comments
  being executed as commands. Preserve substantive checks.
- [x] Full Python and local mock integration suites pass; build and inspect the
  wheel and sdist, including installed-package migrations and UI serving.

## Review evidence

Before this sprint: 425 Python tests passed, one expected skip, 84% coverage;
11 mock integration tests passed, 15 opt-in external-service cases skipped.
Lint and all three type checkers passed. The wheel and Docker image built and
served the UI. Browser smoke checks passed mock login, OAuth, post/favourite/
bookmark, thread reload, admin listing, tiny sample generation, and one-shot
fault injection. Direct SSE delivered a newly created post. Browser automation
timed out during the live-stream check, so that UI interaction was not verified.

`make -k check` failed formatting, metadata sync, and the Windows audit recipe.
Strict MkDocs failed a stale deployment anchor and an orphan Mawkingbird handoff
page. The standalone changelog validator also failed. Logs are in the ignored
`.build/release-review/` directory.

## Completed work and validation

- Packaged migration discovery and configured database selection are fixed.
  Current-schema files created by the server can be adopted without losing data;
  unknown unversioned schemas are refused without schema changes. Regression
  coverage includes repeat upgrades, preserved posts, percent signs in filenames,
  empty targets, and unknown schemas.
- `url_scheme` controls generated links and assets. The CLI infers HTTP/HTTPS
  from its listener; direct Python construction preserves the old HTTPS default.
  Proxy operators can explicitly configure HTTPS. Streaming endpoints continue
  to advertise the actual request origin.
- Metadata and changelog copies are synchronized. The local changelog validator
  now matches the release workflow. Strict MkDocs and changelog-copy checks are
  part of `make docs-check`.
- Corrected public documentation and source-build requirements. Archived the
  Mawkingbird handoff and Mataroa API reference under `sprint/`.
- `make ui-dev` watches the bundle served by Python instead of starting an Angular
  server with no backend proxy. Its initial watch build was verified, then the
  workspace bundle was rebuilt in production mode.
- Final `uv run make check`: passed. 434 Python tests passed, one expected
  no-bundle fallback skip, 84% coverage. Lint, security, three type checkers,
  formatting, metadata, and version checks passed.
- Full UI gate: 42 tests passed. Local mock integration: 11 passed, 15 opt-in
  external-service cases skipped. No real-service writes were enabled.
- `uv run make docs-check` and the final strict MkDocs build passed. The existing
  pydoctest report remains advisory (512 parser/docstring findings); no tests or
  substantive gates were weakened. The pre-existing NLTK audit exception remains.
- Built a wheel from the sdist and installed it in a separate environment outside
  the checkout. `db upgrade --config mock.toml` reached head `e7a91c5b3d42` in the
  selected file. The installed server passed UI/JavaScript/HTTP-image serving,
  mock login, post/favourite/bookmark, deep-link, and SSE smoke checks.
- Twine strict metadata checks passed. Archive inspection found 296 sdist files
  (341,316 bytes) and 138 wheel files (361,670 bytes), including the lite UI and
  packaged migration code, without node_modules, caches, or virtual environments.

Version remains 0.6.0. No release, tag, or publication was performed. Browser
automation was unavailable after its review-time timeout; post-fix integration
verification used the installed server's real HTTP endpoints and the UI suite.
