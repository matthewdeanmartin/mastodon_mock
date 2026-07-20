#!/usr/bin/env bash
# Publish a built site into a subtree of this repo's gh-pages branch, leaving
# every other subtree untouched. Used by both the canary and production
# workflows so prod and canary coexist on one Pages site under one custom domain.
#
# Usage:
#   publish-gh-pages.sh <subpath> <source-dir>
#
#   <subpath>     "root" publishes to the branch root (production);
#                 any other value (e.g. "canary") publishes to that subdir.
#   <source-dir>  directory of built static files to publish.
#
# Requires: GITHUB_TOKEN in the environment (built-in Actions token is enough),
# plus GITHUB_REPOSITORY / GITHUB_SHA / GITHUB_SERVER_URL provided by Actions.
set -euo pipefail

subpath="${1:?usage: publish-gh-pages.sh <subpath> <source-dir>}"
source_dir="${2:?usage: publish-gh-pages.sh <subpath> <source-dir>}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is not set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

branch="gh-pages"
server="${GITHUB_SERVER_URL:-https://github.com}"
host="${server#https://}"
remote="https://x-access-token:${GITHUB_TOKEN}@${host}/${GITHUB_REPOSITORY}.git"

work="$(mktemp -d)"
git clone --depth 1 --branch "$branch" "$remote" "$work" 2>/dev/null || {
  # First run: the branch doesn't exist yet. Start an empty orphan branch.
  echo "gh-pages branch not found; creating a fresh one."
  git clone --depth 1 "$remote" "$work"
  git -C "$work" checkout --orphan "$branch"
  git -C "$work" rm -rf . >/dev/null 2>&1 || true
}

if [ "$subpath" = "root" ]; then
  # Production owns the branch root. Clear every top-level entry EXCEPT the
  # canary subtree and its root redirect shim (and .git), then lay down the new
  # production build. canary.html lets bare /canary bounce to /canary/.
  find "$work" -mindepth 1 -maxdepth 1 \
    ! -name '.git' ! -name 'canary' ! -name 'canary.html' -exec rm -rf {} +
  cp -R "$source_dir/." "$work/"
else
  # A named subpath (e.g. canary) owns only its own directory.
  target="$work/$subpath"
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$source_dir/." "$target/"

  # Root redirect shim so a bare /<subpath> (no trailing slash) reaches the app.
  # GitHub Pages serves /<subpath>.html for the extensionless path /<subpath>
  # before falling back to the production SPA 404.html at root. Production's
  # root-clear preserves this file by name.
  cat > "$work/$subpath.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<title>Redirecting to /$subpath/</title>
<meta http-equiv="refresh" content="0; url=/$subpath/">
<link rel="canonical" href="/$subpath/">
<script>location.replace("/$subpath/" + location.search + location.hash);</script>
<a href="/$subpath/">Continue to /$subpath/</a>
HTML
fi

cd "$work"
touch .nojekyll  # keep Pages from running Jekyll over the static build

git add --all
if git diff --cached --quiet; then
  echo "No changes to publish for '$subpath'."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git commit -m "Deploy ${subpath}: ${GITHUB_REPOSITORY}@${GITHUB_SHA:-unknown}"
git push origin "HEAD:${branch}"
echo "Published '$subpath' to ${branch}."
