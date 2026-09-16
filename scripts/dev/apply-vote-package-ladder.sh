#!/usr/bin/env bash
# Applies migration 20270127000000 to the LOCAL Supabase database.
# Safe to re-run: functions are CREATE OR REPLACE, the trigger is dropped and
# recreated, and the seeder no-ops for any contest that already has packages.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

echo "── before: votability of every contest ─────────────────"
psql "$DB" -P pager=off -c "
select c.title, c.status, c.paid_vote_kobo, c.free_votes_per_user,
       (select count(*) from vote_packages p where p.contest_id=c.id and p.is_active) as active_packages,
       case when c.free_votes_per_user > 0
              or exists (select 1 from vote_packages p where p.contest_id=c.id and p.is_active)
            then 'votable' else 'NOT VOTABLE' end as verdict
from connect_contests c order by c.created_at desc;"

echo "── applying 20270127000000 ─────────────────────────────"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270127000000_vote_packages_default_ladder.sql
echo "   ok"

echo "── after ───────────────────────────────────────────────"
psql "$DB" -P pager=off -c "
select c.title, c.paid_vote_kobo, c.free_votes_per_user,
       (select count(*) from vote_packages p where p.contest_id=c.id and p.is_active) as active_packages,
       case when c.free_votes_per_user > 0
              or exists (select 1 from vote_packages p where p.contest_id=c.id and p.is_active)
            then 'votable' else 'NOT VOTABLE' end as verdict
from connect_contests c order by c.created_at desc;"

echo "── the ladder seeded for September Open Mic (amount is NAIRA) ──"
psql "$DB" -P pager=off -c "
select name, votes, amount, currency, is_recommended, display_order
from vote_packages where contest_id='624b5a24-cd3a-44d3-81b4-7dd15e1da90a' order by display_order;"
