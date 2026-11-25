#!/usr/bin/env bash
# Project gates: TypeScript typecheck + automated tests (vitest) against a throwaway Postgres.
# Everything runs in containers; the stack is removed at the end, pass or fail.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="catraca-gates-$$"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.test.yml)

cleanup() { "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${COMPOSE[@]}" build tests
"${COMPOSE[@]}" run --rm tests
echo ""
echo "GATES OK"
