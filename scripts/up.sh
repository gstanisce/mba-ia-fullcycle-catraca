#!/usr/bin/env bash
# Builds and starts the whole product (Postgres + app). Migrations and seed run on app boot.
# Returns only when the app is healthy.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --build --wait

PORT="${CATRACA_PORT:-3000}"
echo ""
echo "Catraca no ar:"
echo "  WEB = http://localhost:${PORT}"
echo "  API = http://localhost:${PORT}   (rotas em /api/partner/...)"
