#!/usr/bin/env bash
# Publish a built site into a subtree of this repo's gh-pages branch, leaving
# every other subtree untouched. Used by both the canary and production
# workflows so prod and canary coexist on one Pages site under one custom domain.
#
# Usage:
#   publish-gh-pages.sh <subpath> <source-dir>
#
#   <subpath>     "root" publishes to the branch root while preserving canary;
#                 "standalone" replaces the entire branch root;
#                 any other value (e.g. "canary") publishes to that subdir.
#   <source-dir>  directory of built static files to publish.
#
# Requires GITHUB_REPOSITORY plus either GITHUB_TOKEN (for this repository) or
# PUBLISH_REMOTE (for an already-authenticated Git remote, such as a deploy-key
# SSH URL). GITHUB_SHA / GITHUB_SERVER_URL are supplied by Actions.
set -euo pipefail

subpath="${1:?usage: publish-gh-pages.sh <subpath> <source-dir>}"
source_dir="${2:?usage: publish-gh-pages.sh <subpath> <source-dir>}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

branch="gh-pages"
if [ -n "${PUBLISH_REMOTE:-}" ]; then
  remote="$PUBLISH_REMOTE"
else
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is not set and PUBLISH_REMOTE was not provided}"
  server="${GITHUB_SERVER_URL:-https://github.com}"
  host="${server#https://}"
  remote="https://x-access-token:${GITHUB_TOKEN}@${host}/${GITHUB_REPOSITORY}.git"
fi

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
  # sibling subtrees and their root redirect shims (and .git), then lay down the
  # new production build. canary.html lets bare /canary bounce to /canary/.
  #
  # Every sibling app must be named here. A subtree missing from this list is
  # deleted by the next production deploy and does not come back until its own
  # workflow next runs — which, for anything published on the same trigger as
  # canary, is a window rather than a permanent loss and so is easy to miss.
  find "$work" -mindepth 1 -maxdepth 1 \
    ! -name '.git' \
    ! -name 'canary' ! -name 'canary.html' \
    ! -name 'test' ! -name 'test.html' \
    -exec rm -rf {} +
  cp -R "$source_dir/." "$work/"
elif [ "$subpath" = "standalone" ]; then
  # A mirror site owns the whole publishing branch and has no sibling apps or
  # CNAME to preserve.
  find "$work" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
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
  public_base="${PUBLISH_PUBLIC_BASE:-/$subpath/}"
  case "$public_base" in
    /*/) ;;
    *) echo "PUBLISH_PUBLIC_BASE must start and end with '/': $public_base" >&2; exit 2 ;;
  esac
  cat > "$work/$subpath.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<title>Redirecting to $public_base</title>
<meta http-equiv="refresh" content="0; url=$public_base">
<link rel="canonical" href="$public_base">
<script>location.replace("$public_base" + location.search + location.hash);</script>
<a href="$public_base">Continue to $public_base</a>
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
