#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
if command -v go >/dev/null 2>&1 && go version >/dev/null 2>&1; then
  go_command=(go)
elif command -v mise >/dev/null 2>&1; then
  go_command=(mise exec go@latest -- go)
else
  echo 'Go 1.26 or newer is required to build servedir.' >&2
  exit 1
fi
CGO_ENABLED=0 "${go_command[@]}" build -trimpath -ldflags "-s -w -X main.version=${SERVE_DIR_VERSION:-0.1.0}" -o bin/servedir .
echo 'Built bin/servedir'
