UV ?= uv
MAKEFLAGS += --no-print-directory
export PYTHONUTF8 := 1

PACKAGE := mastodon_mock
PYTHON_TARGETS := mastodon_mock tests
PYLINT_MAIN_TARGETS := mastodon_mock
PYLINT_TEST_TARGETS := tests
MARKDOWN_TARGETS := README.md CHANGELOG.md AGENTS.md docs
YAML_TARGETS := .github mkdocs.yml .readthedocs.yaml
GHA_WORKFLOWS := .github/workflows
ABOUT_FILE := mastodon_mock/__about__.py
CHANGELOG := CHANGELOG.md
DOCS_CHANGELOG := docs/CHANGELOG.md
MOCK_DOMAIN := mock.local

# xdist worker count for `test-ci`. Each worker runs its own threaded uvicorn
# server alongside the test process, so `-n auto` (== logical CPUs) oversubscribes
# the machine ~2x: on a many-core box the server event loops get starved and a
# request's response headers never arrive in time, surfacing as spurious
# `httpx2.ReadTimeout` failures (flaky, order-dependent). Capping at half the
# logical CPUs (floor 2) keeps the suite parallel without oversubscription.
# Override with `make test-ci TEST_WORKERS=N`.
TEST_WORKERS ?= $(shell python -c "import os;print(max(2,(os.cpu_count() or 2)//2))")

.PHONY: \
	sync \
	pre-commit-install \
	format format-python format-yaml format-markdown \
	format-check format-check-python format-check-yaml format-check-markdown \
	lint lint-check ruff-fix ruff-check pylint pylint-tests pylint-spelling \
	spell \
	docs-check docs-check-docstrings docs-check-links docs-check-pydoctest griffe \
	changelog-verify changelog-sync \
	build-docs \
	dead-code vulture deadcode \
	explore refurb crosshair deptry import-linter \
	security bandit audit \
	smoke dev-cert dev-cert-named serve-https serve-https-verbose serve-https-443 serve-https-443-named test test-ci tox \
	typecheck typecheck-mypy typecheck-ty typecheck-pyrefly \
	metadata metadata-check version-check dev-status \
	gha-validate gha-pin gha-upgrade publish-gha \
	prerelease publish-check publish \
	ui ui-dev mockingbird \
	vendor-openapi compare-openapi openapi-fuzz \
	check check-ci \
	help

help:
	@echo "Targets:"
	@echo "  sync                   Install / refresh dependencies"
	@echo "  pre-commit-install     Install pre-commit hooks into .git/hooks"
	@echo ""
	@echo "  format                 Auto-format all code and markup"
	@echo "  format-check           Check formatting without changes"
	@echo "  lint                   Ruff fix + pylint (main + tests)"
	@echo "  lint-check             Ruff check + pylint (read-only)"
	@echo "  spell                  Spell-check code, docs, and README"
	@echo ""
	@echo "  test                   Run pytest suite with coverage"
	@echo "  test-ci                Run pytest in parallel (-n $(TEST_WORKERS); override TEST_WORKERS=N)"
	@echo "  tox                    Run tests across py310-py313 via tox-uv"
	@echo "  smoke                  CLI smoke checks (--help, --version)"
	@echo "  dev-cert               Generate a self-signed localhost TLS cert into .dev_certs/"
	@echo "  dev-cert-named         Same, plus MOCK_DOMAIN (default mock.local) in the SAN list"
	@echo "  serve-https            Run the demo server over HTTPS on :3443 (for Whalebird etc.)"
	@echo "  serve-https-verbose    Same, with uvicorn's trace log level (debugging a client)"
	@echo "  serve-https-443        Same, but on :443 (no port in the URL); needs admin/root"
	@echo "  serve-https-443-named  :443 + MOCK_DOMAIN; needs the hosts-file mapping too"
	@echo ""
	@echo "  typecheck              Run mypy strict + ty + pyrefly"
	@echo "  security               Run bandit + uv audit + pip-audit"
	@echo ""
	@echo "  metadata               Regenerate __about__.py from pyproject.toml"
	@echo "  metadata-check         Verify __about__.py is in sync"
	@echo "  version-check          Verify version consistency (jiggle_version)"
	@echo "  dev-status             Verify Development Status classifier"
	@echo ""
	@echo "  docs-check             All doc checks (docstrings + links + pydoctest)"
	@echo "  docs-check-docstrings  interrogate docstring coverage"
	@echo "  docs-check-pydoctest   pydoctest docstring example tests"
	@echo "  docs-check-links       linkcheckMarkdown"
	@echo "  griffe                 griffe API surface check (advisory)"
	@echo "  build-docs             Build mkdocs documentation"
	@echo ""
	@echo "  dead-code              vulture + deadcode (advisory, non-blocking)"
	@echo ""
	@echo "  explore                All four exploratory tools in sequence"
	@echo "  refurb                 Modern Python idiom suggestions (advisory)"
	@echo "  crosshair              Symbolic execution / contract checking (advisory)"
	@echo "  deptry                 Unused / missing / misplaced deps (advisory)"
	@echo "  import-linter          Enforce import architecture contracts (advisory)"
	@echo ""
	@echo "  gha-validate           YAML parse + artifact handoff check + zizmor"
	@echo "  gha-pin                Pin GHA action refs to commit SHAs"
	@echo "  gha-upgrade            Pin + validate (gha-pin then gha-validate)"
	@echo "  publish-gha            Dispatch the GitHub Actions publish workflow"
	@echo ""
	@echo "  vendor-openapi         Re-vendor upstream schema into git (run by hand, then commit)"
	@echo "  compare-openapi        Diff mock OpenAPI vs upstream -> spec report"
	@echo "  openapi-fuzz           OpenAPI contract fuzzing (needs the contract extra)"
	@echo ""
	@echo "  check                  Full local quality gate"
	@echo "  check-ci               CI quality gate (no formatting mutations)"
	@echo "  prerelease             All checks before publishing"
	@echo "  publish-check          Build wheel and list dist/ contents"
	@echo "  publish                Publish via uv (OIDC or UV_PUBLISH_TOKEN)"

sync:
	@$(UV) sync

pre-commit-install:
	@$(UV) run pre-commit install

# ── Formatting ────────────────────────────────────────────────────────────────

format: format-python format-yaml format-markdown

format-python:
	@$(UV) run isort $(PYTHON_TARGETS)
	@$(UV) run black $(PYTHON_TARGETS)
	@$(UV) run ruff check --fix --quiet $(PYTHON_TARGETS)
	@$(UV) run black $(PYTHON_TARGETS)

format-yaml:
	@$(UV) run yamlfix $(YAML_TARGETS)

format-markdown:
	@$(UV) run mdformat $(MARKDOWN_TARGETS)

format-check: format-check-python format-check-yaml format-check-markdown

format-check-python:
	@$(UV) run isort --check-only $(PYTHON_TARGETS)
	@$(UV) run black --check $(PYTHON_TARGETS)
	@$(UV) run ruff check --quiet $(PYTHON_TARGETS)

format-check-yaml:
	@$(UV) run yamlfix --check $(YAML_TARGETS)

format-check-markdown:
	@$(UV) run mdformat --check $(MARKDOWN_TARGETS)

# ── Linting ───────────────────────────────────────────────────────────────────

lint: ruff-fix pylint pylint-tests

lint-check: ruff-check pylint pylint-tests

ruff-fix:
	@$(UV) run ruff check --fix --quiet $(PYTHON_TARGETS)

ruff-check:
	@$(UV) run ruff check --quiet $(PYTHON_TARGETS)

pylint:
	@$(UV) run pylint --score=n --reports=n --rcfile=.pylintrc $(PYLINT_MAIN_TARGETS)

pylint-tests:
	@$(UV) run pylint --score=n --reports=n --rcfile=.pylintrc_tests $(PYLINT_TEST_TARGETS)

pylint-spelling:
	@$(UV) run pylint --score=n --reports=n --rcfile=.pylintrc_spell $(PYLINT_MAIN_TARGETS)

# ── Spell check ───────────────────────────────────────────────────────────────

spell: pylint-spelling
	@$(UV) run codespell --ignore-words=private_dictionary.txt \
		$(PACKAGE) tests README.md CHANGELOG.md AGENTS.md docs

# ── Documentation checks ─────────────────────────────────────────────────────

docs-check: docs-check-docstrings docs-check-pydoctest docs-check-links changelog-verify

docs-check-docstrings:
	@$(UV) run interrogate $(PACKAGE) --verbose --fail-under 70

docs-check-pydoctest:
	@$(UV) run pydoctest --config .pydoctest.json \
		| grep -v "__init__" | grep -v "__main__" | grep -v "Unable to parse" || true

docs-check-links:
	@$(UV) run linkcheckMarkdown README.md || true
	@$(UV) run mdformat --check README.md CHANGELOG.md docs/*.md || true

griffe:
	@echo "=== griffe API surface check (advisory) ==="
	@$(UV) run griffe check $(PACKAGE) || true

# ── Changelog ────────────────────────────────────────────────────────────────
# The canonical changelog lives at the repo root; mkdocs needs a copy inside
# docs/ for its nav. changelog-sync validates + formats the root file, then
# copies it into docs/ so the two never drift.

changelog-verify:
	@$(UV) run kacl-cli -f $(CHANGELOG) verify

changelog-sync: changelog-verify
	@$(UV) run mdformat $(CHANGELOG)
	@cp $(CHANGELOG) $(DOCS_CHANGELOG)
	@echo "Synced $(CHANGELOG) -> $(DOCS_CHANGELOG)"

build-docs: changelog-sync
	@$(UV) run mkdocs build

# ── Dead code analysis (advisory — non-blocking) ─────────────────────────────

dead-code: vulture deadcode

vulture:
	@echo "=== vulture (advisory) ==="
	@$(UV) run vulture $(PACKAGE) --min-confidence 80 || true

deadcode:
	@echo "=== deadcode (advisory) ==="
	@$(UV) run deadcode $(PACKAGE) || true

# ── Exploratory / advisory tools (not wired into any gate) ───────────────────
# Run these when you're curious, not as a blocking check.
# False-positive rate is high enough in Python that none of these should fail CI.

explore: refurb crosshair deptry import-linter

refurb:
	@echo "=== refurb: modern Python idiom suggestions (advisory) ==="
	@$(UV) run refurb $(PACKAGE) || true

crosshair:
	@echo "=== crosshair: symbolic execution / contract checking (advisory) ==="
	@$(UV) run crosshair check $(PACKAGE) || true

deptry:
	@echo "=== deptry: unused / missing / misplaced dependencies (advisory) ==="
	@$(UV) run deptry . || true

import-linter:
	@echo "=== import-linter: import architecture contracts (advisory) ==="
	@echo "    Requires a [importlinter] section in pyproject.toml or .importlinter"
	@$(UV) run lint-imports || true

# ── Security ──────────────────────────────────────────────────────────────────

security: bandit audit

bandit:
	@$(UV) run bandit -q -c pyproject.toml -r $(PACKAGE)

audit:
	@echo "=== uv audit ==="
	@$(UV) audit --ignore-until-fixed GHSA-p4gq-832x-fm9v
	@echo "=== pip-audit ==="
	@$(UV) run pip-audit

# ── Tests ─────────────────────────────────────────────────────────────────────

smoke:
	@$(UV) run bash scripts/basic_checks.sh

dev-cert:
	@bash scripts/gen_dev_cert.sh

# A cert covering a named domain (MOCK_DOMAIN, default "mock.local") instead of just
# localhost/127.0.0.1/::1 — for clients that reject bare IPs/localhost outright. You
# must separately map the domain to 127.0.0.1 in your hosts file; this only issues
# the cert. Override the name with `make dev-cert-named MOCK_DOMAIN=example.local`.
dev-cert-named:
	@bash scripts/gen_dev_cert.sh .dev_certs "$(MOCK_DOMAIN)"

serve-https: dev-cert
	@$(UV) run mastodon_mock serve --in-memory --demo --port 3443 \
		--ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem

# Same as serve-https but at uvicorn's most verbose log level — useful for seeing the
# exact headers/requests a misbehaving client sends (e.g. diagnosing a 4xx with no
# other clue). Output is noisy; prefer plain serve-https for normal use.
serve-https-verbose: dev-cert
	@$(UV) run mastodon_mock serve --in-memory --demo --port 3443 --log-level trace \
		--ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem

# Binding :443 lets a client that strips non-standard ports from a typed domain
# (e.g. tuba-windows-portable) still reach the mock without a port in the URL.
# Ports below 1024 usually need elevation: on Windows, run this from an Administrator
# shell; on Linux/macOS, prefix with sudo or grant the interpreter CAP_NET_BIND_SERVICE.
serve-https-443: dev-cert
	@$(UV) run mastodon_mock serve --in-memory --demo --port 443 \
		--ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem

# Named-domain + port 443 combined: for clients needing both a real hostname and no
# port in the URL. Requires the hosts-file mapping from dev-cert-named, plus the same
# elevation caveat as serve-https-443.
serve-https-443-named: dev-cert-named
	@$(UV) run mastodon_mock serve --in-memory --demo --port 443 --domain "$(MOCK_DOMAIN)" \
		--ssl-keyfile .dev_certs/localhost-key.pem --ssl-certfile .dev_certs/localhost-cert.pem

test:
	@$(UV) run pytest -q -p no:sugar \
		--cov=$(PACKAGE) \
		--cov-report=html \
		--junitxml=junit.xml \
		--timeout=60

test-ci:
	@$(UV) run pytest -q -p no:sugar -n $(TEST_WORKERS) --dist=loadfile \
		--cov=$(PACKAGE) \
		--cov-report=xml \
		--junitxml=junit.xml \
		--timeout=60

test-integration:
	@$(UV) run pytest -q tests/integration -m integration --timeout=60

# ── Performance ──────────────────────────────────────────────────────────────
# Benchmark suite (spec/09-sample-data-and-perf.md). Opt-in via the `slow` marker.

perf:
	@$(UV) run pytest -q tests/perf -m slow --timeout=300

perf-baseline:
	@echo "Re-run perf with PERF_UPDATE_BASELINE=1 and hand-edit tests/perf/baselines.json"
	@$(UV) run pytest -q tests/perf -m slow --timeout=300 -rA

gen-data-medium:
	@$(UV) run mastodon_mock gen-data --preset medium --database ./perf.db --yes

test-integration-real:
	@RUN_REAL_MASTODON_TESTS=1 $(UV) run pytest -q tests/integration -m integration --timeout=60

tox:
	@$(UV) run tox

# ── Type checking ─────────────────────────────────────────────────────────────

typecheck: typecheck-mypy typecheck-ty typecheck-pyrefly

typecheck-mypy:
	@$(UV) run mypy --hide-error-context $(PACKAGE)

typecheck-ty:
	@$(UV) run ty check $(PACKAGE)

typecheck-pyrefly:
	@$(UV) run pyrefly check $(PACKAGE)

# ── Metadata / version ───────────────────────────────────────────────────────

metadata:
	@$(UV) run metametameta pep621 --name $(PACKAGE) --source pyproject.toml --output $(ABOUT_FILE)

metadata-check:
	@$(UV) run metametameta sync-check --output $(ABOUT_FILE)

version-check:
	@$(UV) run jiggle_version check

dev-status:
	@$(UV) run troml-dev-status validate .

# ── GitHub Actions maintenance ───────────────────────────────────────────────

gha-validate:
	@echo "Validating GitHub Actions workflows"
	@$(UV) run python -c "import pathlib, yaml; [yaml.safe_load(p.read_text(encoding='utf-8')) for p in pathlib.Path('$(GHA_WORKFLOWS)').glob('*.yml')]; print('YAML parse OK')"
	@uvx zizmor --no-progress --no-exit-codes .

gha-pin:
	@echo "Pinning GitHub Actions to current commit SHAs"
	@$(UV) run python -c "import os, subprocess, sys; \
token=os.environ.get('GITHUB_TOKEN') or subprocess.run(['gh', 'auth', 'token'], capture_output=True, text=True).stdout.strip(); \
assert token, 'Set GITHUB_TOKEN or run: gh auth login'; \
env=dict(os.environ, GITHUB_TOKEN=token); \
raise SystemExit(subprocess.run(['gha-update'], env=env).returncode)"

gha-upgrade: gha-pin gha-validate
	@echo "GitHub Actions upgrade complete"

publish-gha:
	@echo "Dispatching GitHub Actions publish workflow"
	gh workflow run publish_to_pypi.yml --ref main

# ── Release gates ─────────────────────────────────────────────────────────────

ui:
	@echo "Building Angular admin panel / client UI -> mastodon_mock/_ui_dist"
	@cd ui && npm ci && npm run build

ui-dev:
	@cd ui && npm start

# Build the standalone "Mocking Bird" static client (no mock-server tooling).
# Output: ui/dist-mockingbird/browser — a pure static site for any Mastodon instance.
# Override the base href for sub-path hosting (e.g. GitHub project Pages):
#   make mockingbird MOCKINGBIRD_BASE_HREF=/mastodon_mock/
MOCKINGBIRD_BASE_HREF ?= /
mockingbird:
	@echo "Building Mocking Bird static client -> ui/dist-mockingbird (base-href=$(MOCKINGBIRD_BASE_HREF))"
	@cd ui && npm ci && npm run build -- --configuration mockingbird --base-href $(MOCKINGBIRD_BASE_HREF)

# Re-vendor the upstream Mastodon OpenAPI schema into git. Run this by hand like a
# formatter: it overwrites the tracked mastodon-openapi/dist/schema.json, then you review
# the diff and commit it yourself. Not wired into CI or any quality gate. The contract
# tests (tests/test_openapi_contract.py) compare against the committed snapshot.
UPSTREAM_OPENAPI_REPO ?= https://github.com/abraham/mastodon-openapi.git
vendor-openapi:
	@echo "Re-vendoring upstream schema from $(UPSTREAM_OPENAPI_REPO) -> mastodon-openapi/dist/schema.json"
	@tmp=$$(mktemp -d) ; \
	git clone --depth 1 $(UPSTREAM_OPENAPI_REPO) "$$tmp" ; \
	if [ ! -f "$$tmp/dist/schema.json" ]; then \
		echo "ERROR: upstream schema not found at dist/schema.json — upstream layout may have changed" >&2 ; \
		rm -rf "$$tmp" ; exit 1 ; \
	fi ; \
	mkdir -p mastodon-openapi/dist ; \
	cp "$$tmp/dist/schema.json" mastodon-openapi/dist/schema.json ; \
	rm -rf "$$tmp"
	@git diff --quiet -- mastodon-openapi/dist/schema.json \
		&& echo "No drift - vendored schema already current." \
		|| echo "Schema updated. Review 'git diff mastodon-openapi/dist/schema.json', run the contract tests, and commit."

compare-openapi:
	@echo "Comparing mock OpenAPI against upstream Mastodon schema -> spec/openapi_compare_report.md"
	@$(UV) run mastodon_mock compare-openapi --format markdown --out spec/openapi_compare_report.md
	@$(UV) run mastodon_mock compare-openapi --format text

# OpenAPI contract fuzzing (Phase 3). Needs the `contract` extra; opt-in.
#   make openapi-fuzz             -> "mock never 500s" on the shared GET surface
#   CONTRACT_STRICT=1 make openapi-fuzz  -> full schema conformance (finds shape gaps)
openapi-fuzz:
	@$(UV) sync --extra contract
	@$(UV) run pytest -m contract tests/test_openapi_fuzz.py

publish-check:
	@$(UV) build
	@echo "Distribution built — inspect dist/ before publishing."
	@ls -lh dist/

publish:
	@echo "Publishing via uv (set UV_PUBLISH_TOKEN or configure OIDC trusted publishing)"
	@$(UV) publish

check: format-check lint-check security test typecheck metadata-check version-check
	@echo "All checks passed."

check-ci: lint-check security test-ci typecheck metadata-check version-check
	@echo "CI checks passed."

prerelease: check dev-status docs-check smoke spell publish-check
	@echo "Pre-release checks complete — ready to publish."
lease: check dev-status docs-check smoke spell publish-check
	@echo "Pre-release checks complete — ready to publish."
