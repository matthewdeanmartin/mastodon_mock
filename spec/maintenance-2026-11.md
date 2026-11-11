# Mastodon stable API maintenance

Scope: Python server only. The bundled UI is frozen; continued UI development is
owned by the sibling Mawkingbird repository. Mastodon 5.0 remains a preview target.

## Sprint 1: compatibility and contract tracking

- Default target: Mastodon 4.7.5; previous target: 4.6.11. Both advertise API 11.
  Preserve API 10 for 4.6.0 and recognize the 4.6.1 patch-level capability change.
  Unknown future versions conservatively advertise the latest implemented level.
- Persist avatar/header descriptions through JSON and form updates, return them
  from account/profile responses, enforce the upstream 150-character limit, and
  clear descriptions when deleting the associated image. Empty descriptions are
  empty strings, matching Mastodon's database and the stable contract.
- Preserve the committed stable schema and separately pin a reviewed upstream
  preview snapshot. Record source commits and hashes normalized to LF in
  `mastodon-openapi/provenance.json`.
- Monitor optional parameters, request bodies, response schemas, and components
  with `uv run python -m mastodon_mock.openapi_drift`. The weekly workflow fails
  on new structural drift and uploads a report. It does not open pull requests.
- Regenerate the mock surface report and the stable-to-preview change report.
  Schema version labels are insufficient: the preview still says 4.7.0 while
  documenting 5.0 features. The structural report also includes documentation
  corrections, not just newly introduced server behavior.

## Sprint 2: stable behavior and collections

- Seed invalid remote handles and account deletion requests. Invalid handles
  retain their account IDs and use the upstream fallback username/acct in account
  responses and status mentions. Accounts awaiting deletion are excluded from
  account reads, lookup, discovery, and authenticated actions.
- Support account-timeline `exclude_direct`, preserving followers-only posts
  visible through explicit mentions. Preserve filters in pagination links.
- Exclude suspended/deleted requesters and cap credential follow-request counts
  at 40. Test existing bulk notification-request cleanup and disabled-staff
  rejection instead of duplicating already-correct logic.
- Return the grouped notification's `most_recent_notification_id` as an integer,
  matching upstream's serializer and contract; pagination IDs remain strings.
- Replace collection stubs with persistent CRUD, ownership checks, discovery
  visibility, offset pagination, item uniqueness and parent scoping, revocation,
  and local addition/update notifications in v1/v2 notification responses.
  Apply the default ten-collection quota, 25-item limit, 40-character name limit,
  and 100-character description limit. Local featured accounts must opt into
  discovery; locked accounts require a follow relationship or self-featuring.
- Add two Alembic revisions and test upgrades/downgrades from the previous head,
  data preservation, metadata parity, and persistent collection reads after restart.

For existing versioned file databases, stop the server and run
`uv run mastodon_mock db upgrade --config /path/to/mock.toml` before restarting.
Ephemeral databases start with the new schema automatically. The upgrade command
deliberately refuses to guess the baseline of an old unversioned database; establish
its reviewed migration baseline first. This maintenance did not alter user databases.

## Deliberate boundaries

The mock does not federate. Remote collection members are modeled as pending;
remote interaction-policy negotiation and approval delivery are not implemented.
The ten-collection quota uses the standard role default rather than a configurable
role-permission system. Existing fake admin authorization remains permissive for
active users; disabled/suspended accounts are still rejected by default. Setting
`moderation.enforce_actions = false` retains the documented legacy behavior.

Collections do not implement Mastodon's complete language/tag moderation policy.
These limits are separate from endpoint availability and are not hidden by the
zero-missing-operations surface report.

5.0 home-feed filters, OAuth signup, nonfunctional credential states, and the new
empty-search behavior are recorded in the preview snapshot, not enabled here.

## Sources and validation

Implementation was checked against the local Mastodon reference clone at
`cc76f85b9a`, with stable changes verified using its `v4.6.0`, `v4.6.11`, and
`v4.7.5` tags. Snapshot provenance records the documentation/generator commits.

Validation includes HTTP round trips, ownership/visibility failures, transactional
rollback, duplicate/limit handling, notifications, migration preservation, and
targeted strict OpenAPI fuzzing. The full Python suite is the final runtime gate;
the frozen UI is not part of this change.

Validation results: 460 passed and one existing skip in the full Python suite;
20 targeted strict-fuzz cases passed for account/profile/collection endpoints.
Formatting of changed files, Ruff/Pylint, all three type checkers, metadata/version
checks, and Bandit passed. Populated collection and notification responses were
also checked against the reviewed upstream schemas.

The repository-wide quality gate also encounters pre-existing YAML formatting
drift in five unrelated workflows and dependency audit findings in the unchanged
lockfile. These require separate cleanup; no audit exceptions or test skips were
added for this maintenance work.
