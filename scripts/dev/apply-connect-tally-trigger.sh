#!/usr/bin/env bash
# Applies migration 20270140000000 to the LOCAL Supabase database. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270140000000_connect_tally_follows_credit.sql
echo "  applied"
