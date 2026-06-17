"""Mock-only fault-injection control plane. See spec/fault_injection.md.

Holds an ordered list of fault rules on ``app.state.fault_store`` and a middleware
that, before each request, applies the first matching rule: a forced status, added
latency, a malformed body, or a hung connection. Mock-only paths
(``/api/v1/_mock/*``) are never affected, so a fault can't lock you out of the
control plane.
"""

from __future__ import annotations

import asyncio
import fnmatch
import itertools
import re
import time
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import RequestResponseEndpoint

# Faults must never touch the control plane itself or the reset/login helpers.
_EXEMPT_PREFIX = "/api/v1/_mock"

_VALID_EFFECTS = {"status", "ratelimit", "latency", "malformed", "timeout"}


@dataclass
class FaultRule:
    """A single fault rule (see the spec for the field semantics)."""

    id: str
    methods: list[str] | None
    path: str | None
    path_regex: str | None
    effect_type: str
    status: int
    body: Any
    headers: dict[str, str]
    delay_ms: int
    truncate: bool
    remaining: int | None  # None = fire forever

    def matches(self, method: str, path: str) -> bool:
        """Whether this rule applies to a ``method`` + ``path`` request."""
        if self.methods is not None and method.upper() not in self.methods:
            return False
        if self.path_regex is not None:
            return re.search(self.path_regex, path) is not None
        if self.path is not None:
            if "*" in self.path:
                return fnmatch.fnmatch(path, self.path)
            return path == self.path
        return True  # no path constraint ⇒ matches everything

    def to_dict(self) -> dict[str, Any]:
        """Serialize for the GET/POST responses."""
        return {
            "id": self.id,
            "match": {"methods": self.methods, "path": self.path, "path_regex": self.path_regex},
            "effect": {
                "type": self.effect_type,
                "status": self.status,
                "body": self.body,
                "headers": self.headers,
                "delay_ms": self.delay_ms,
                "truncate": self.truncate,
            },
            "remaining": self.remaining,
        }


class FaultStore:
    """Ordered, mutable collection of fault rules."""

    def __init__(self) -> None:
        self._rules: list[FaultRule] = []
        self._ids = itertools.count(1)

    def add(self, spec: dict[str, Any]) -> FaultRule:
        """Build and append a rule from a (validated) request body."""
        match = spec.get("match") or {}
        effect = spec.get("effect") or {}
        effect_type = str(effect.get("type", "status"))
        if effect_type not in _VALID_EFFECTS:
            raise ValueError(f"Unknown effect type {effect_type!r}; valid: {sorted(_VALID_EFFECTS)}")

        methods = match.get("methods")
        if methods is not None:
            methods = [str(m).upper() for m in methods]

        count = spec.get("count")
        rule = FaultRule(
            id=f"r{next(self._ids)}",
            methods=methods,
            path=match.get("path"),
            path_regex=match.get("path_regex"),
            effect_type=effect_type,
            status=int(effect.get("status", 429 if effect_type == "ratelimit" else 500)),
            body=effect.get("body"),
            headers={str(k): str(v) for k, v in (effect.get("headers") or {}).items()},
            delay_ms=int(effect.get("delay_ms", 0)),
            truncate=bool(effect.get("truncate", True)),
            remaining=None if count is None else int(count),
        )
        self._rules.append(rule)
        return rule

    def list(self) -> list[FaultRule]:
        """Current rules in evaluation order."""
        return list(self._rules)

    def remove(self, rule_id: str) -> bool:
        """Delete one rule by id; returns whether it existed."""
        before = len(self._rules)
        self._rules = [r for r in self._rules if r.id != rule_id]
        return len(self._rules) != before

    def clear(self) -> None:
        """Drop all rules."""
        self._rules.clear()

    def take_match(self, method: str, path: str) -> FaultRule | None:
        """Return the first matching rule, decrementing/expiring its budget."""
        for rule in self._rules:
            if rule.matches(method, path):
                if rule.remaining is not None:
                    rule.remaining -= 1
                    if rule.remaining <= 0:
                        self._rules.remove(rule)
                return rule
        return None


def add_fault_middleware(app: FastAPI) -> None:
    """Install the fault middleware (called only when faults are enabled)."""

    @app.middleware("http")
    async def _apply_faults(request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        store: FaultStore | None = getattr(request.app.state, "fault_store", None)
        if store is None or path.startswith(_EXEMPT_PREFIX):
            return await call_next(request)

        rule = store.take_match(request.method, path)
        if rule is None:
            return await call_next(request)
        return await _apply(rule, request, call_next)


async def _apply(rule: FaultRule, request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Realize a single fault rule's effect."""
    if rule.delay_ms:
        await asyncio.sleep(rule.delay_ms / 1000.0)

    if rule.effect_type == "latency":
        return await call_next(request)

    if rule.effect_type == "timeout":
        # Hold the connection until the client gives up (or a sane upper bound).
        await asyncio.sleep(max(rule.delay_ms, 30_000) / 1000.0)
        return await call_next(request)

    if rule.effect_type == "malformed":
        text = '{"error": "truncated' if rule.truncate else "{not json"
        return Response(content=text, media_type="application/json", status_code=200, headers=rule.headers or None)

    # status / ratelimit
    body: Any = rule.body if rule.body is not None else {"error": _default_message(rule.status)}
    headers = dict(rule.headers)
    if rule.effect_type == "ratelimit":
        now = int(time.time())
        headers.setdefault("X-RateLimit-Limit", "300")
        headers.setdefault("X-RateLimit-Remaining", "0")
        headers.setdefault("X-RateLimit-Reset", str(now + 300))
        headers.setdefault("Retry-After", "300")
    return JSONResponse(status_code=rule.status, content=body, headers=headers or None)


def _default_message(status: int) -> str:
    """A Mastodon-shaped default error message for a forced status."""
    return {
        429: "Too many requests",
        500: "An unexpected error occurred",
        502: "Bad gateway",
        503: "Service temporarily unavailable",
    }.get(status, "An error occurred")
