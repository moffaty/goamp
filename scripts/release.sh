#!/bin/bash
set -e

# Usage: ./scripts/release.sh [patch|minor|major] or ./scripts/release.sh 0.2.0

CURRENT=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
echo "Current version: $CURRENT"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "${1:-patch}" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  [0-9]*.[0-9]*.[0-9]*) IFS='.' read -r MAJOR MINOR PATCH <<< "$1" ;;
  *) echo "Usage: $0 [patch|minor|major|x.y.z]"; exit 1 ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
echo "New version: $NEW"

# Update version in all config files
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" src-tauri/tauri.conf.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" package.json

# Update Cargo.toml version
sed -i "s/^version = \"$CURRENT\"/version = \"$NEW\"/" src-tauri/Cargo.toml

# Update Cargo.lock
cd src-tauri && cargo update -p goamp --precise "$NEW" 2>/dev/null || true && cd ..

echo "Updated to v$NEW"
echo ""
echo "To release, run:"
echo "  git add -A && git commit -m 'release: v$NEW' && git tag v$NEW && git push && git push --tags"
