#!/usr/bin/env bash
# Re-runs migrations + seed inside the running app container. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T app npm run --silent seed
