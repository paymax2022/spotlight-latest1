#!/usr/bin/env bash
# Sweep synthetic test fixtures ('<uuid>@seed.test' users and the marketplace
# fixture categories) from a DEVELOPMENT database. See the .sql for what is
# deliberately left behind.
#
#   scripts/dev/sweep-test-fixtures.sh [DATABASE_URL]
#
# Defaults to the local Supabase instance. Refuses anything that does not look
# local unless SWEEP_I_KNOW_WHAT_IM_DOING=1 — this deletes across the schema, and
# pointing it at staging would take real accounts' data with it.
set -euo pipefail

DSN="${1:-${TEST_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:54322/postgres}}"

if [[ "$DSN" != *"127.0.0.1"* && "$DSN" != *"localhost"* && "${SWEEP_I_KNOW_WHAT_IM_DOING:-0}" != "1" ]]; then
  echo "refusing: '$DSN' is not a local database." >&2
  echo "set SWEEP_I_KNOW_WHAT_IM_DOING=1 to override." >&2
  exit 1
fi

exec psql "$DSN" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/sweep-test-fixtures.sql"
