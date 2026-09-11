# Lite UI rollback

## Backup and selected baseline

Permanent remote backup: `codex/backup-before-ui-rollback-2026-09-11`, at
`3c752fb82fdad9ff9f0bc0964c5052e812ab3dc3`. The push was verified against
`git ls-remote`. Keep this branch indefinitely.

Restore baseline: `6239b715c77189e3c221ee241c7ab0563e9ec640`, June 22, 2026,
"quote retweets work again". This retains mock login, sample-data tools,
administration, fault injection, Mastodon OAuth login, and quote fixes.

## Archaeology

| Point | Meaning |
| --- | --- |
| June 15, `09e3dadce` | UI begins. |
| June 19, `53aa9f659` | Test client can log into mastodon.social. |
| June 22, `6239b715c` | Last UI state before standalone product infrastructure. |
| June 22, `b7e8e6215` | "mockingbird": standalone Angular configuration, environment replacements, and Pages publisher. |
| July 11 | Branding/domain/sidebar work resumes after the June pause. |
| July 13–14 | Blue checks, reader mode, house ads, RSS, and Bluesky turn it into a broader product. |
| September 7, `4d981c458` | Source split snapshot, already the full product. |

UI-touching commits by month in the backup's history: June 13, July 205,
August 236, September 48. The baseline has 138 tracked UI files; the backup
has 1,568. Rolling back to early July would retain the standalone product
build machinery; June 22 is the cleaner mock-focused boundary.

## Scope

The historical UI source and lockfile are restored without rewriting history.
Small additions retain a local `make test` entry point, ignore existing local
generated artifacts, and document this decision. Historical specs remain intact.

Outside `ui/`, remove the Mawkingbird CI job, scheduled starter-kit workflow,
and root standalone build target; update ownership/deployment guidance. Keep
the Python implementation and tests unchanged. Narrow the sdist UI inputs and
explicitly exclude nested dependency/cache/virtualenv directories.

The lite UI still builds into `mastodon_mock/_ui_dist/browser` and is bundled
in wheels. The sdist contains source and lockfile so a wheel can build from it.
Mawkingbird publishers and product development belong in `../mawkingbird`.

## Validation

- Full restored UI suite: `cd ui && make test`, 42 tests in six files pass.
- Production UI build: `cd ui && npm run build`, passes.
- Python UI serving tests: `uv run pytest tests/test_ui.py -q`, five pass;
  the no-bundle fallback test is conditionally skipped because the UI is built.
- `uv build --out-dir .build/ui-rollback` builds the sdist and then rebuilds
  the wheel from that sdist successfully.
- Archive inspection: sdist 294 files / 339,015 bytes; wheel 137 files /
  359,123 bytes. The sdist has UI source, lockfile, configuration, and build
  hook; the wheel has the compiled UI index and all current Python modules.
  Neither archive has `node_modules`, caches, virtualenvs, translation scratch,
  or standalone Mawkingbird output. The sdist has no prebuilt UI assets.
- Remaining workflow YAML parses successfully.
- Git comparison confirms no changes to `mastodon_mock/`, `tests/`,
  `hatch_build.py`, or `uv.lock`.

The historical dependency install reported 29 audit findings, including one
critical. Production dependencies account for six findings (three high and
three moderate; none critical).

## Dependency refresh after rollback (2026-09-11)

Ran `npm update` within the existing `package.json` version ranges, then
verified a clean `npm ci`. No ranges were changed, and no overrides, forced
versions, or audit-fix commands were used. The refreshed lockfile resolves
Angular runtime/compiler packages to 21.2.23, Angular CLI/build to 21.2.24,
Vitest to 4.1.11, and Prettier to 3.9.6, plus compatible transitive updates.

`npm ls --depth=0` passes. The full `make test` suite passes all 42 tests,
and `npm run build` produces the bundled lite UI successfully. The clean
install reports zero audit findings at the time of this refresh. Distribution
sizes above describe the original rollback validation, before this refresh.
