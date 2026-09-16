#!/usr/bin/env bash
# Applies migration 20270125000000 to the LOCAL Supabase database and backfills
# the applicants who were approved before the seam existed.
#
# Safe to re-run: the function is CREATE OR REPLACE, the index is IF NOT EXISTS,
# the dedupe finds nothing once it has run, and promote_registration_to_contestant
# is idempotent via the partial unique index on contestants.registration_id.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin

DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)
[ -n "$DB" ] || { echo "DATABASE_URL missing from backend/.env" >&2; exit 1; }

echo "── before ──────────────────────────────────────────────"
psql "$DB" -P pager=off -c "
select r.status,
       count(*) as registrations,
       count(*) filter (where exists (select 1 from contestants c where c.registration_id = r.id)) as on_roster
from registrations r
where r.status in ('approved','selected_for_public_voting','selected_for_bootcamp')
group by 1 order by 1;"

echo "── applying 20270125000000 ─────────────────────────────"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270125000000_registration_review_seam_and_dedupe.sql
echo "   ok"

echo "── backfilling approvals that predate the seam ─────────"
psql "$DB" -v ON_ERROR_STOP=1 -P pager=off -c "
select r.id,
       r.contest_slug,
       public.promote_registration_to_contestant(r.id) as contestant_id
from registrations r
where r.status in ('approved','selected_for_public_voting','selected_for_bootcamp')
  and not exists (select 1 from contestants c where c.registration_id = r.id);"

echo "── after ───────────────────────────────────────────────"
psql "$DB" -P pager=off -c "
select r.status,
       count(*) as registrations,
       count(*) filter (where exists (select 1 from contestants c where c.registration_id = r.id)) as on_roster
from registrations r
where r.status in ('approved','selected_for_public_voting','selected_for_bootcamp')
group by 1 order by 1;"

psql "$DB" -P pager=off -c "
select c.id, c.name, c.status, c.is_active, cc.title as contest
from contestants c
left join connect_contests cc on cc.id = c.connect_contest_id
where c.registration_id is not null
order by c.created_at desc limit 10;"
