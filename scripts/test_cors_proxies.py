"""Small, browser-oriented smoke test for public CORS proxy services.

The test intentionally makes only a few requests per service.  It checks the
parts that matter to a browser client: a non-CORS upstream response, request
header forwarding, and the preflight response needed for a JSON POST.
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ORIGIN = "http://localhost:4200"
TARGET_WITHOUT_CORS = "https://example.com/"
TARGET_ECHO = "https://httpbingo.org/anything?cors_probe=1"
PROBE_HEADER = "X-Cors-Probe"
PROBE_VALUE = "mastodon-mock-cors-smoke-test"
REQUESTED_HEADERS = "Content-Type, Authorization, X-Cors-Probe"
TIMEOUT_SECONDS = 20
USER_AGENT = "Mozilla/5.0 (compatible; cors-proxy-smoke-test/1.0)"


@dataclass
class ProbeResult:
    """Result of one HTTP probe."""

    service: str
    probe: str
    url: str
    status: int | None
    elapsed_ms: int | None
    cors_origin: str | None
    cors_methods: str | None
    cors_headers: str | None
    cors_origin_ok: bool | None
    cors_preflight_ok: bool | None
    header_forwarded: bool | None
    response_preview: str
    error: str | None = None


def get_header(headers: Any, name: str) -> str | None:
    """Read a response header case-insensitively."""
    value = headers.get(name)
    return str(value) if value is not None else None


def header_allows(value: str | None, wanted: str) -> bool:
    """Return whether a comma-separated CORS header allows a value."""
    if value is None:
        return False
    values = {part.strip().lower() for part in value.split(",")}
    return "*" in values or wanted.lower() in values


def make_proxy_url(service: str, target: str) -> str:
    """Build the service URL for a target URL."""
    encoded = quote(target, safe="")
    if service == "CORSPROXY.io":
        key = os.environ.get("CORSPROXY_KEY")
        prefix = "https://corsproxy.io/?"
        return f"{prefix}key={quote(key, safe='')}&url={encoded}" if key else f"{prefix}url={encoded}"
    if service == "FixCors":
        return f"https://fixcors.com/api/proxy?url={encoded}"
    if service == "CORS.lol":
        return f"https://api.cors.lol/?url={encoded}"
    if service == "Abundance APIs":
        return f"https://cors-proxy-web-toolbox.p.rapidapi.com/proxy?url={encoded}"
    if service == "HTTP Cors Proxy (RapidAPI)":
        return f"https://http-cors-proxy.p.rapidapi.com/?url={encoded}"
    if service == "X2U":
        email = os.environ.get("X2U_EMAIL")
        api_key = os.environ.get("X2U_API_KEY")
        if email and api_key:
            return (
                "https://go.x2u.in/proxy?"
                f"email={quote(email, safe='')}&apiKey={quote(api_key, safe='')}&url={encoded}"
            )
        return f"https://go.x2u.in/proxy?url={encoded}"
    raise ValueError(f"Unknown service: {service}")


def request(
    url: str,
    method: str,
    headers: dict[str, str],
    body: bytes | None = None,
) -> tuple[int, Any, bytes, int]:
    """Make one request and return status, headers, body, and elapsed time."""
    started = time.perf_counter()
    request_headers = {"User-Agent": USER_AGENT, **headers}
    request_object = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request_object, timeout=TIMEOUT_SECONDS) as response:
            payload = response.read(4096)
            return response.status, response.headers, payload, round((time.perf_counter() - started) * 1000)
    except HTTPError as error:
        payload = error.read(4096)
        return error.code, error.headers, payload, round((time.perf_counter() - started) * 1000)


def failed_result(service: str, probe: str, url: str, error: Exception) -> ProbeResult:
    """Create a result for a transport-level failure."""
    return ProbeResult(
        service=service,
        probe=probe,
        url=url,
        status=None,
        elapsed_ms=None,
        cors_origin=None,
        cors_methods=None,
        cors_headers=None,
        cors_origin_ok=None,
        cors_preflight_ok=None,
        header_forwarded=None,
        response_preview="",
        error=f"{type(error).__name__}: {error}",
    )


def get_probe(service: str) -> ProbeResult:
    """Check fetching a target that does not publish CORS headers."""
    url = make_proxy_url(service, TARGET_WITHOUT_CORS)
    try:
        status, headers, payload, elapsed_ms = request(
            url,
            "GET",
            {"Origin": ORIGIN, **rapidapi_headers(service)},
        )
        cors_origin = get_header(headers, "Access-Control-Allow-Origin")
        return ProbeResult(
            service,
            "GET non-CORS target",
            url,
            status,
            elapsed_ms,
            cors_origin,
            get_header(headers, "Access-Control-Allow-Methods"),
            get_header(headers, "Access-Control-Allow-Headers"),
            status is not None and header_allows(cors_origin, ORIGIN),
            None,
            None,
            payload.decode("utf-8", errors="replace")[:240],
        )
    except (OSError, URLError, ValueError) as error:
        return failed_result(service, "GET non-CORS target", url, error)


def header_probe(service: str) -> ProbeResult:
    """Check forwarding of a custom request header to an echo endpoint."""
    url = make_proxy_url(service, TARGET_ECHO)
    try:
        status, headers, payload, elapsed_ms = request(
            url,
            "GET",
            {"Origin": ORIGIN, PROBE_HEADER: PROBE_VALUE, **rapidapi_headers(service)},
        )
        cors_origin = get_header(headers, "Access-Control-Allow-Origin")
        payload_text = payload.decode("utf-8", errors="replace")
        return ProbeResult(
            service,
            "GET custom-header echo",
            url,
            status,
            elapsed_ms,
            cors_origin,
            get_header(headers, "Access-Control-Allow-Methods"),
            get_header(headers, "Access-Control-Allow-Headers"),
            status is not None and header_allows(cors_origin, ORIGIN),
            None,
            PROBE_VALUE.lower() in payload_text.lower(),
            payload_text[:240],
        )
    except (OSError, URLError, ValueError) as error:
        return failed_result(service, "GET custom-header echo", url, error)


def preflight_probe(service: str) -> ProbeResult:
    """Check the CORS preflight response for a cross-origin JSON POST."""
    url = make_proxy_url(service, TARGET_ECHO)
    try:
        status, headers, payload, elapsed_ms = request(
            url,
            "OPTIONS",
            {
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": REQUESTED_HEADERS,
                **rapidapi_headers(service),
            },
        )
        cors_origin = get_header(headers, "Access-Control-Allow-Origin")
        cors_methods = get_header(headers, "Access-Control-Allow-Methods")
        cors_headers = get_header(headers, "Access-Control-Allow-Headers")
        preflight_ok = (
            status is not None
            and 200 <= status < 300
            and header_allows(cors_origin, ORIGIN)
            and header_allows(cors_methods, "POST")
            and all(header_allows(cors_headers, name) for name in REQUESTED_HEADERS.split(", "))
        )
        return ProbeResult(
            service,
            "OPTIONS preflight for POST",
            url,
            status,
            elapsed_ms,
            cors_origin,
            cors_methods,
            cors_headers,
            status is not None and header_allows(cors_origin, ORIGIN),
            preflight_ok,
            None,
            payload.decode("utf-8", errors="replace")[:240],
        )
    except (OSError, URLError, ValueError) as error:
        return failed_result(service, "OPTIONS preflight for POST", url, error)


def rapidapi_headers(service: str) -> dict[str, str]:
    """Return RapidAPI headers when a key is available."""
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        return {}
    host = (
        "cors-proxy-web-toolbox.p.rapidapi.com"
        if service == "Abundance APIs"
        else "http-cors-proxy.p.rapidapi.com"
    )
    return {"X-RapidAPI-Key": key, "X-RapidAPI-Host": host}


def run_service(service: str) -> list[ProbeResult]:
    """Run the appropriate low-volume probes for one service."""
    if service in {"Abundance APIs", "HTTP Cors Proxy (RapidAPI)"} and not os.environ.get("RAPIDAPI_KEY"):
        return [
            ProbeResult(
                service,
                "credential availability",
                make_proxy_url(service, TARGET_WITHOUT_CORS),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                "Skipped active probes: set RAPIDAPI_KEY to test this RapidAPI service.",
            )
        ]
    if service == "X2U" and not (os.environ.get("X2U_EMAIL") and os.environ.get("X2U_API_KEY")):
        return [
            ProbeResult(
                service,
                "credential availability",
                make_proxy_url(service, TARGET_WITHOUT_CORS),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                "Skipped active probes: set X2U_EMAIL and X2U_API_KEY to test this service.",
            )
        ]
    return [get_probe(service), header_probe(service), preflight_probe(service)]


def print_result(result: ProbeResult) -> None:
    """Print a compact human-readable result."""
    if result.error:
        outcome = result.error
    elif result.probe == "GET non-CORS target":
        outcome = f"HTTP {result.status}; browser-readable CORS={result.cors_origin_ok}"
    elif result.probe == "GET custom-header echo":
        outcome = f"HTTP {result.status}; CORS={result.cors_origin_ok}; header-forwarded={result.header_forwarded}"
    elif result.probe == "OPTIONS preflight for POST":
        outcome = f"HTTP {result.status}; preflight={result.cors_preflight_ok}"
    else:
        outcome = result.response_preview
    print(f"{result.service:30} | {result.probe:28} | {outcome}")


def main() -> int:
    """Run probes and save detailed results next to this script."""
    services = [
        "CORSPROXY.io",
        "Abundance APIs",
        "FixCors",
        "HTTP Cors Proxy (RapidAPI)",
        "X2U",
        "CORS.lol",
    ]
    print(f"Origin under test: {ORIGIN}")
    print(f"Non-CORS upstream: {TARGET_WITHOUT_CORS}")
    results = [result for service in services for result in run_service(service)]
    for result in results:
        print_result(result)
    output_path = Path(__file__).with_name("cors_proxy_results.json")
    output_path.write_text(json.dumps([asdict(result) for result in results], indent=2), encoding="utf-8")
    print(f"Detailed results: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
