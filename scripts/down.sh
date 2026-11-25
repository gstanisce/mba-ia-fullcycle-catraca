#!/usr/bin/env bash
# Stops and removes every container/network started by scripts/up.sh.
# Data volume is kept (seed is idempotent). Pass --purge to also delete the database volume.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--purge" ]]; then
  docker compose down --remove-orphans --volumes
else
  docker compose down --remove-orphans
fi
