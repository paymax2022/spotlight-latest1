#!/usr/bin/env bash
# Applies migration 20270139000000 to the LOCAL Supabase database. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

state() {
psql "$DB" -P pager=off -c "
select c.title, c.status as contest,
       coalesce(vs.status,'(no row)') as settings,
       vs.voting_enabled as enabled, vs.paid_voting_enabled as paid, vs.voting_type,
       case when vs.id is not null and vs.status='active' and vs.voting_enabled
            then 'can take votes' else 'CANNOT TAKE VOTES' end as verdict
from connect_contests c left join voting_settings vs on vs.contest_id=c.id
order by (c.status='open') desc, c.title;"
}
echo "── before ──────────────────────────────────────────────"; state
echo "── applying 20270139000000 ─────────────────────────────"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270139000000_voting_settings_follow_contest.sql
echo "   ok"
echo "── after ───────────────────────────────────────────────"; state
echo "── any OPEN contest that still cannot take votes? (expect 0) ──"
psql "$DB" -t -A -c "
select count(*) from connect_contests c
left join voting_settings vs on vs.contest_id=c.id
where c.status='open' and (vs.id is null or vs.status <> 'active' or not vs.voting_enabled);"
