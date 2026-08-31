#!/usr/bin/env bash
# Applies migration 20270128000000 to the LOCAL Supabase database.
# Idempotent: CREATE OR REPLACE, DROP/CREATE trigger, and the backfill matches
# nothing once it has run.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

votability() {
psql "$DB" -P pager=off -c "
select c.title, c.status, c.paid_vote_kobo, c.free_votes_per_user,
       (select count(*) from vote_packages p where p.contest_id=c.id and p.is_active) as packages,
       case when c.free_votes_per_user > 0
              or exists (select 1 from vote_packages p where p.contest_id=c.id and p.is_active)
            then 'votable' else 'NOT VOTABLE' end as verdict
from connect_contests c order by verdict, c.title;"
}

echo "── before ──────────────────────────────────────────────"; votability
echo "── applying 20270128000000 ─────────────────────────────"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270128000000_open_contests_always_votable.sql
echo "   ok"
echo "── after ───────────────────────────────────────────────"; votability
echo "── any unvotable contest left? (expect 0) ──────────────"
psql "$DB" -t -A -c "
select count(*) from connect_contests c
where c.free_votes_per_user <= 0
  and not exists (select 1 from vote_packages p where p.contest_id=c.id and p.is_active);"
