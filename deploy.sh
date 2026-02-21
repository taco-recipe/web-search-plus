#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec bash "$ROOT_DIR/scripts/deploy.sh" "$@"
