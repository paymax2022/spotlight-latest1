#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270141000000_voting_trigger_functions_security_definer.sql
psql "$DB" -P pager=off -c "
select proname, prosecdef as security_definer from pg_proc
where proname in ('seed_default_vote_packages','mirror_connect_contest_to_legacy',
                  'ensure_voting_settings','tg_connect_tally_follows_credit',
                  'tg_open_contest_needs_votes') order by proname;"
