FROM python:3.13-slim

LABEL maintainer="matthewdeanmartin@gmail.com"
LABEL description="Stateful Mastodon mock server that mocks the REST API with a minimal in-memory/sqlite database"

WORKDIR /app

# Non-root user for runtime isolation
RUN useradd --create-home --shell /bin/bash appuser

# Install the package as root so the venv is system-wide, then drop to appuser
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir mastodon_mock

# Drop privileges
USER appuser

# Default: show help.  Override CMD or pass arguments after the image name.
ENTRYPOINT ["mastodon_mock"]
CMD ["--help"]
