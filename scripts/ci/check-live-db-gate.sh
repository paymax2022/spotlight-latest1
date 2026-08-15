#!/usr/bin/env bash
# Guard: no Go TEST may read DATABASE_URL.
#
# The root .env points DATABASE_URL at the PRODUCTION Supabase pooler. Live-DB
# suites in this repo INSERT fixtures and several of them move money, so a test
# that reads DATABASE_URL — directly, or as a fallback when TEST_DATABASE_URL is
# unset — writes to production the moment a developer sources .env and runs
# `go test ./...`.
#
# Live-DB tests must gate on TEST_DATABASE_URL alone:
#
#     dsn := os.Getenv("TEST_DATABASE_URL")
#     if dsn == "" {
#         t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
#     }
#
# Module-specific vars (MARKETPLACE_TEST_DATABASE_URL, DOCTOR_TEST_DATABASE_URL)
# are fine — they are test-only names. Only bare DATABASE_URL is rejected.
#
# integration-verify.yml sets TEST_DATABASE_URL at job level, so dropping the
# fallback costs no CI coverage. See backend/tests/TEST_STRATEGY.md
# § "Live-DB suites: the TEST_DATABASE_URL gate".
#
# Non-test code (cmd/ binaries, config loading) reads DATABASE_URL legitimately
# and is not scanned.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# `os.Getenv("DATABASE_URL")` exactly — a longer name such as
# MARKETPLACE_TEST_DATABASE_URL cannot match, because the quote is part of the
# pattern.
PATTERN='os\.Getenv\("DATABASE_URL"\)'

HITS=$(grep -rn --include='*_test.go' -E "$PATTERN" backend/ || true)

if [ -n "$HITS" ]; then
  echo "$HITS" | while IFS= read -r line; do
    file="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    echo "::error file=${file},line=${lineno}::Test reads DATABASE_URL (the production pooler). Gate on TEST_DATABASE_URL only — see scripts/ci/check-live-db-gate.sh"
  done
  echo ""
  echo "FAILED: $(echo "$HITS" | wc -l | tr -d ' ') test occurrence(s) read DATABASE_URL."
  echo "Replace with TEST_DATABASE_URL and drop any fallback."
  exit 1
fi

echo "live-DB gate guard passed — no test reads DATABASE_URL."
