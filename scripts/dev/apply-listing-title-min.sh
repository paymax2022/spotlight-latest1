#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB="${DATABASE_URL:-$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)}"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270157000000_mkt_listing_title_min_length.sql
psql "$DB" -P pager=off -c "
select pg_get_constraintdef(oid) as now_enforced from pg_constraint
where conrelid='public.mkt_listings'::regclass and conname='mkt_listings_title_check';"
