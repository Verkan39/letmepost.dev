#!/usr/bin/env bash
# Run the exact same checks GitHub Actions runs, in the same order, with
# the same throwaway env vars, against a local Postgres. Catches the
# "passes locally because my .env is loaded" trap that bit us when the
# scaffolding first landed.
#
# Prerequisites:
#   - Postgres running on localhost:5432 with a database we can write to
#     (the dev compose stack provides one: `docker compose -f
#     docker-compose.dev.yml up -d postgres`).
#   - pnpm + Node 24.
#
# Usage:
#   scripts/ci-local.sh           # full run (typecheck + lint + migrate + test)
#   scripts/ci-local.sh --fast    # typecheck + lint only (~30s — the CI merge gate today)
#
# Exit code matches the failing step. Use this BEFORE pushing a CI change
# instead of waiting for Actions to tell you.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAST_ONLY=0
[ "${1:-}" = "--fast" ] && FAST_ONLY=1

# Throwaway env values matching the CI workflow exactly.
export CI=true
export DATABASE_URL="${DATABASE_URL:-postgres://ci:ci@localhost:5432/letmepost_ci_local}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-$DATABASE_URL}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-ci-throwaway-secret-not-used-anywhere-real}"
export KEK_MASTER="${KEK_MASTER:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

# Hide the .env so dotenv-loading code can't paper over a missing env var
# the way it did in CI. Restored on EXIT.
ENV_FILES=(apps/api/.env apps/dashboard/.env apps/web/.env)
trap 'for f in "${ENV_FILES[@]}"; do [ -f "$f.ci-local-bak" ] && mv "$f.ci-local-bak" "$f"; done' EXIT
for f in "${ENV_FILES[@]}"; do
  [ -f "$f" ] && mv "$f" "$f.ci-local-bak"
done

step() { printf "\n\033[36m── %s ──\033[0m\n" "$1"; }
fail() { printf "\n\033[31m✗ ci-local: %s failed\033[0m\n" "$1"; exit 1; }

step "1/4  typecheck"
pnpm typecheck || fail "typecheck"

step "2/4  lint"
pnpm lint || fail "lint"

if [ "$FAST_ONLY" = "1" ]; then
  printf "\n\033[32m✓ ci-local --fast passed (typecheck + lint)\033[0m\n"
  exit 0
fi

step "3/4  db:migrate"
if ! pnpm --filter @letmepost/api db:migrate; then
  printf "\n\033[33m! db:migrate failed — is Postgres running on localhost:5432?\033[0m\n"
  printf "   try: docker compose -f docker-compose.dev.yml up -d postgres\n"
  fail "db:migrate"
fi

step "4/4  test"
pnpm test || fail "test"

printf "\n\033[32m✓ ci-local passed (typecheck + lint + migrate + test)\033[0m\n"
