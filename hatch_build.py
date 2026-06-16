"""Hatchling build hook: build the Angular UI before assembling the wheel.

Runs ``npm ci`` + ``npm run build`` in ``ui/``, which emits the bundle into
``mastodon_mock/_ui_dist/browser`` (configured in ``ui/angular.json``). That directory
is then shipped via the wheel ``include`` in ``pyproject.toml``.

Behavior:

* If Node/npm is available, always (re)build so the shipped bundle is fresh.
* If npm is missing but a previously built ``_ui_dist`` exists, ship it as-is (lets a
  CI step pre-build the UI and a later wheel build pick it up without Node).
* If npm is missing and there is no prior build, fail loudly — a wheel without the UI
  would silently regress ``/_ui/``.

Set ``MASTODON_MOCK_SKIP_UI_BUILD=1`` to skip the build entirely (e.g. when the UI was
built in a separate step). See spec/08-admin-ui.md.
"""

from __future__ import annotations

import os
import shutil
import subprocess  # nosec B404
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

ROOT = Path(__file__).parent
UI_DIR = ROOT / "ui"
DIST_DIR = ROOT / "mastodon_mock" / "_ui_dist"


class UIBuildHook(BuildHookInterface):  # type: ignore[type-arg]
    """Build the Angular SPA into mastodon_mock/_ui_dist before the wheel is built."""

    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        """Run the UI build (or reuse a prior build) prior to wheel assembly."""
        if os.environ.get("MASTODON_MOCK_SKIP_UI_BUILD") == "1":
            self.app.display_info("MASTODON_MOCK_SKIP_UI_BUILD=1 set; skipping Angular UI build.")
            return

        npm = shutil.which("npm")
        already_built = (DIST_DIR / "browser" / "index.html").is_file()

        if npm is None:
            if already_built:
                self.app.display_warning("npm not found; shipping existing mastodon_mock/_ui_dist as-is.")
                return
            raise RuntimeError(
                "npm not found and no prebuilt UI at mastodon_mock/_ui_dist. "
                "Install Node.js, or set MASTODON_MOCK_SKIP_UI_BUILD=1 to skip the UI."
            )

        if not (UI_DIR / "package.json").is_file():
            raise RuntimeError(f"UI sources not found at {UI_DIR}.")

        self.app.display_info("Building Angular UI (npm ci && npm run build)…")
        subprocess.run([npm, "ci"], cwd=UI_DIR, check=True)  # nosec B603
        subprocess.run([npm, "run", "build"], cwd=UI_DIR, check=True)  # nosec B603

        if not (DIST_DIR / "browser" / "index.html").is_file():
            raise RuntimeError(f"UI build did not produce {DIST_DIR / 'browser' / 'index.html'}.")
