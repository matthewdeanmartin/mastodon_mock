# syntax=docker/dockerfile:1
# Multi-stage build for the mastodon_mock server (FastAPI + bundled /_ui/ SPA).
#
# Stage 1 builds the Angular UI and a wheel from the local source, so the image can be
# built and smoke-tested from a checkout without waiting on a PyPI release. Stage 2 is a
# slim runtime that installs only the wheel.

# ---- Stage 1: build the wheel (incl. the Angular UI bundle) ----
FROM python:3.13-slim AS build

# Node is needed by the hatch build hook (hatch_build.py) to compile the Angular UI into
# mastodon_mock/_ui_dist before the wheel is assembled.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir build

WORKDIR /src
COPY . .

# Build the wheel; the custom hatch hook runs `npm ci && npm run build` for the UI.
RUN python -m build --wheel --outdir /dist

# ---- Stage 2: slim runtime ----
FROM python:3.13-slim AS runtime

LABEL maintainer="matthewdeanmartin@gmail.com"
LABEL org.opencontainers.image.title="mastodon_mock"
LABEL org.opencontainers.image.description="Stateful Mastodon mock server (REST API + bundled web UI) backed by a minimal SQLite database"
LABEL org.opencontainers.image.source="https://github.com/matthewdeanmartin/mastodon_mock"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Non-root user for runtime isolation.
RUN useradd --create-home --shell /bin/bash appuser

# System-wide venv on PATH.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install just the built wheel — no Node, no source tree in the final image.
RUN --mount=from=build,source=/dist,target=/dist \
    pip install --no-cache-dir /dist/*.whl

USER appuser

# PaaS hosts (Render/Railway/Koyeb/...) inject $PORT; the CLI reads $PORT/$HOST when no
# --port/--host flag is given (see mastodon_mock/cli.py). Default to a public bind so the
# container is reachable; override the command to customize.
ENV PORT=8000
EXPOSE 8000

ENTRYPOINT ["mastodon_mock"]
CMD ["serve", "--host", "0.0.0.0"]
