# Contributor guide

This section is for people changing `mastodon_mock` itself. If you are writing a test
against the mock, start with the [user guide](../index.md) instead.

## A useful reading order

1. [Architecture](../overview/how-it-works.md#for-contributors) — follow a request from
   FastAPI through the database and serializer layers.
2. [Data models](data-models.md) — understand the persisted entities and their edges
   before changing schema or behavior.
3. [Endpoint workflow](../extending/CONTRIBUTING.md) — add routes, serializers, migrations,
   and contract tests end to end.
4. [OpenAPI sync and contract tasks](../extending/openapi-sync.md) — reconcile behavior with
   the Mastodon API contract.

## Contributor principles

- Keep behavior stateful: a successful write should be observable by a later read.
- Keep API shapes Mastodon-compatible; serializers are the boundary that protects clients
  from ORM details.
- Treat Alembic migrations as the schema history. `create_all()` is only a convenience for
  fresh test databases.
- Add a contract test for behavior visible through Mastodon.py, not only an internal unit
  test.
- Keep mock-only endpoints under `/api/v1/_mock/` and out of the real-client contract suite.
