#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_SCRIPT="$ROOT_DIR/scripts/setup-openclaw.mjs"

if [ ! -f "$NODE_SCRIPT" ]; then
  echo "Missing script: $NODE_SCRIPT" >&2
  exit 1
fi

exec node "$NODE_SCRIPT" "$@"
