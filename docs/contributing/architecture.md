# Contributor architecture

The full request lifecycle is documented in [How It Works](../overview/how-it-works.md).
This contributor section keeps the navigation focused while that shared page remains useful
to both test authors and maintainers.

When changing code, trace a request through:

1. the FastAPI route in `mastodon_mock/routers/`;
2. dependency-injected authentication and SQLAlchemy session handling in `deps.py`;
3. durable state in `db/models.py` and cross-cutting writes in `services.py`; and
4. the Mastodon-shaped serializer in `serializers/`.

Then read [Data models](data-models.md) before changing schema and [Endpoint workflow](../extending/CONTRIBUTING.md) before adding a route.
