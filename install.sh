#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "[dsh-version-manager] Node.js was not found on PATH." >&2
  exit 1
fi
exec node "$DIR/install.mjs" "$@"
