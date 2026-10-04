#!/usr/bin/env bash
# Prepare the isolated demo database without starting Ollama or Electron.
set -euo pipefail
for argument in "$@"; do
  if [[ "$argument" != --reset ]]; then
    echo "Usage: ./setup-demo-db-ubuntu.sh [--reset]"
    exit 1
  fi
done
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/start-ubuntu.sh" --seed-only "$@"
