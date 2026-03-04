#!/usr/bin/env bash
set -euo pipefail

# Bump the version across all source-of-truth files.
# Usage: ./scripts/bump-version.sh 0.1.6

NEW_VERSION="${1:?Usage: bump-version.sh <new-version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Validate semver-ish format
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.1.6)" >&2
  exit 1
fi

# Read current version from package.json
CURRENT="$(node -p "require('$ROOT/package.json').version")"

if [[ "$CURRENT" == "$NEW_VERSION" ]]; then
  echo "Already at $NEW_VERSION, nothing to do."
  exit 0
fi

echo "Bumping $CURRENT → $NEW_VERSION"

# 1. package.json
sed -i'' -e "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/package.json"

# 2. src-tauri/tauri.conf.json
sed -i'' -e "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$ROOT/src-tauri/tauri.conf.json"

# 3. src-tauri/Cargo.toml (only the package version line)
sed -i'' -e "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" "$ROOT/src-tauri/Cargo.toml"

# 4. Update Cargo.lock by running cargo check
echo "Updating Cargo.lock..."
(cd "$ROOT/src-tauri" && cargo update -p pko-tools --quiet 2>/dev/null || true)

echo "Done. Updated files:"
echo "  package.json"
echo "  src-tauri/tauri.conf.json"
echo "  src-tauri/Cargo.toml"
echo "  src-tauri/Cargo.lock"
echo ""
echo "Next steps:"
echo "  git add -A && git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  git tag pko-tools-v$NEW_VERSION"
echo "  git push origin main pko-tools-v$NEW_VERSION"
