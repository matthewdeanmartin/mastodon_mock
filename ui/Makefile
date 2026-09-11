.DEFAULT_GOAL := help

.PHONY: help install build test

help:
	@echo "Mock-server UI: make install, make build, make test"

install:
	npm ci

build:
	npm run build

test:
	npm test -- --watch=false
