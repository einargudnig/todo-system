#!/usr/bin/env bash
# Convenience wrapper to build & run the TypeScript todo-sync CLI.
# Usage: ./todo-sync-ts.sh [setup|things|asana|all]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build if dist/ is missing or source is newer
if [ ! -d "$SCRIPT_DIR/dist" ] || [ "$(find "$SCRIPT_DIR/src" -name '*.ts' -newer "$SCRIPT_DIR/dist/cli.js" 2>/dev/null)" ]; then
  echo "Building TypeScript..." >&2
  npx --prefix "$SCRIPT_DIR" tsc
fi

node "$SCRIPT_DIR/dist/cli.js" "$@"
