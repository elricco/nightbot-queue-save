#!/usr/bin/env bash
#
# Build a release zip containing only the files needed to install and run the
# tool. Excludes tests, docs, node_modules, git, and any local secrets/data.
#
# Usage: npm run release   (or: bash scripts/make-release.sh)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="nightbot-queue-save"
VERSION="$(node -p "require('./package.json').version")"

# Files/dirs required for install + operation.
FILES=(
  "src"
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  ".env.example"
  "README.md"
)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$NAME"
mkdir -p "$DEST"

for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then
    echo "error: required file missing: $f" >&2
    exit 1
  fi
  # -R copies directories recursively and is a no-op flag for plain files.
  cp -R "$f" "$DEST/"
done

mkdir -p release
ZIP="$ROOT/release/${NAME}-${VERSION}.zip"
rm -f "$ZIP"
( cd "$STAGE" && zip -rq "$ZIP" "$NAME" )

echo "Created release/${NAME}-${VERSION}.zip"
unzip -l "$ZIP"
