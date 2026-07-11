.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

.PHONY: help install format format-check lint test test-ci build build-admin build-mockingbird security check check-ci

help:
	@echo "Angular quality gates (admin UI + Mockingbird):"
	@echo "  make install            Install locked dependencies"
	@echo "  make format             Auto-format sources"
	@echo "  make format-check       Check formatting without changes"
	@echo "  make lint               Lint TypeScript and templates"
	@echo "  make test               Run tests with coverage"
	@echo "  make build              Production-build admin UI and Mockingbird"
	@echo "  make build-admin        Build the packaged admin UI"
	@echo "  make build-mockingbird  Build the standalone Mockingbird site"
	@echo "  make security           Audit production dependencies"
	@echo "  make check              Full read-only quality gate"

install:
	npm ci

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

test:
	npm run test:ci

test-ci: test

build: build-admin build-mockingbird

build-admin:
	npm run build

build-mockingbird:
	npm run build:mockingbird

security:
	npm audit --omit=dev --audit-level=high

check: format-check lint test build security

check-ci: check
