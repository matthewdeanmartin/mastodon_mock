# Fault Injection

This document specifies a **mock-only control plane** for making endpoints misbehave on
demand, so client code can test the paths that a happy-path mock never reaches: retry and
back-off logic, `429` rate-limit handling, `5xx` surfacing, timeout behaviour, and JSON
parser resilience.

It is the chaos-engineering analog of the existing `_mock/*` dev helpers. Like them it
lives under `/api/v1/_mock/`, is unauthenticated, and is exempt from scope enforcement.

## Model

The server holds an ordered list of **fault rules** in `app.state`. Before each request is
handled, middleware finds the **first matching, non-exhausted** rule and applies its
effect. Rules are matched on method + path; a rule can fire a fixed number of times
(`count`) or until cleared.

A rule:

```jsonc
{
  "id": "r1",                 // assigned by the server
  "match": {
    "methods": ["POST"],      // optional; default = any method
    "path": "/api/v1/statuses",   // exact path OR a glob ("/api/v1/statuses/*")
    "path_regex": null         // optional alternative to `path`
  },
  "effect": {
    "type": "status",         // status | latency | malformed | reset_peer | timeout
    "status": 503,            // for type=status
    "body": {"error": "..."}, // optional override body for type=status
    "headers": {"Retry-After": "5"},   // optional extra response headers
    "delay_ms": 2000,         // for type=latency / added to any effect
    "truncate": true          // for type=malformed: send half-a-JSON-doc
  },
  "count": 3,                 // fire at most 3 times, then auto-expire; null = forever
  "remaining": 3             // server-tracked countdown
}
```

### Effect types

| `type` | Behaviour |
|--------------|------------------------------------------------------------------------------|
| `status` | Short-circuit with the given HTTP `status` and body (defaults to a Mastodon-shaped `{"error": ...}`). Use for `500`/`503`/`502`. |
| `ratelimit` | Convenience for `status` 429 with `X-RateLimit-*` + `Retry-After` headers populated, exactly like the opt-in rate-limiter, so `Mastodon.py`'s `ratelimit_method` engages. |
| `latency` | Sleep `delay_ms`, then process normally. For testing client read-timeouts. |
| `malformed` | Return `200` with a `Content-Type: application/json` body that is **not** valid JSON (a truncated object), so the client's parser raises. |
| `timeout` | Hold the connection open without responding (until the client times out or `delay_ms` elapses, whichever first). For testing connect/read timeouts. |

`delay_ms` may be combined with any `status`/`malformed` effect to delay it.

## Endpoints

| Endpoint | Purpose |
|------------------------------------------|------------------------------------------------------|
| `POST   /api/v1/_mock/faults` | Add a rule. Body = a rule (without `id`/`remaining`). Returns the stored rule with its `id`. |
| `GET    /api/v1/_mock/faults` | List active rules with their `remaining` counts. |
| `DELETE /api/v1/_mock/faults/{id}` | Remove one rule. |
| `DELETE /api/v1/_mock/faults` | Clear all rules. |

Rules are evaluated in insertion order; the first match wins. A rule with `count` set
decrements `remaining` on each fire and is dropped when it reaches zero. Mock-only paths
(`/api/v1/_mock/*`, including the faults API itself) are **never** affected, so a fault can
never lock you out of the control plane or the reset endpoint.

## Matching

- `methods`: list of upper-case HTTP methods. Omitted ⇒ matches any.
- `path`: matched against the request path. Supports a trailing/embedded `*` glob
  (`fnmatch` semantics, e.g. `/api/v1/statuses/*`). Exact string if no `*`.
- `path_regex`: a full `re` pattern, mutually exclusive with `path`.

If neither `path` nor `path_regex` is given, the rule matches every (non-`_mock`) path —
useful for "make the whole API flaky" tests.

## Worked examples

Fail the next two status posts with `503`, then recover:

```python
import httpx2 as httpx
base = mastodon_mock_server.base_url
httpx.post(f"{base}/api/v1/_mock/faults", json={
    "match": {"methods": ["POST"], "path": "/api/v1/statuses"},
    "effect": {"type": "status", "status": 503},
    "count": 2,
})
# first two posts raise MastodonServiceUnavailableError; the third succeeds
```

Make one request rate-limited so the client backs off:

```python
httpx.post(f"{base}/api/v1/_mock/faults", json={
    "match": {"path": "/api/v1/timelines/home"},
    "effect": {"type": "ratelimit", "headers": {"Retry-After": "1"}},
    "count": 1,
})
```

Return malformed JSON to exercise parser resilience:

```python
httpx.post(f"{base}/api/v1/_mock/faults", json={
    "match": {"path": "/api/v1/accounts/verify_credentials"},
    "effect": {"type": "malformed"},
    "count": 1,
})
```

## Testing helper

`MockServer` gains a thin wrapper so tests don't poke the endpoint by hand:

```python
def test_retry_on_503(mastodon_mock_server):
    alice = mastodon_mock_server.client("alice")
    with mastodon_mock_server.fault(path="/api/v1/statuses", methods=["POST"],
                                    status=503, count=1):
        # client's own retry should ride over the single 503
        ...
    # context exit clears the rule
```

`MockServer.fault(**rule)` accepts flattened kwargs (`path`, `methods`, `status`,
`delay_ms`, `type`, `count`, ...), registers the rule on entry, and deletes it on exit. It
returns the rule id for manual deletion if used without `with`.

## Configuration

Fault injection is always available (it does nothing until a rule is added), but the whole
control plane can be disabled for environments that must not expose it:

```toml
[tool.mastodon_mock.faults]
enabled = true    # default true; false ⇒ the /_mock/faults routes 404 and no middleware runs
```

## Non-goals

- **No persistence.** Rules live in memory and are cleared by `/_mock/reset` and on
  restart.
- **No partial-body / byte-level corruption** beyond the `malformed` truncation; the goal
  is to trip the parser, not to fuzz it.
- **Not a load/latency model.** `latency` is a fixed per-rule sleep, not a distribution.
- **No interaction with real auth.** Faults are applied before routing and ignore the
  bearer token except where a rule matches by path.
