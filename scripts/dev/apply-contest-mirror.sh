#!/usr/bin/env bash
# Applies migration 20270129000000 to the LOCAL Supabase database.
# Idempotent: CREATE OR REPLACE, DROP/CREATE trigger, and the mirror is
# insert-only with ON CONFLICT DO NOTHING.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

gap() {
psql "$DB" -P pager=off -c "
select count(*) filter (where not exists (select 1 from contests l where l.id=c.id)) as connect_without_legacy,
       count(*) as connect_total
from connect_contests c;"
}
echo "── before ──────────────────────────────────────────────"; gap
echo "── applying 20270129000000 ─────────────────────────────"
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20270129000000_mirror_connect_contests_to_legacy.sql
echo "   ok"
echo "── after (expect 0 missing) ────────────────────────────"; gap
echo "── the three that were orphaned ────────────────────────"
psql "$DB" -P pager=off -c "
select c.title, c.status as connect_status, l.status as legacy_status,
       c.paid_vote_kobo, l.vote_price_ngn, c.free_votes_per_user, l.max_votes_per_user
from connect_contests c join contests l on l.id=c.id
where c.slug in ('e2e-new-pitch-contest','qa-verify-create-flow','qa-stages-test-contest');"
echo "── money fidelity across ALL contests (any drift?) ─────"
psql "$DB" -P pager=off -c "
select count(*) as contests_whose_kobo_price_drifted
from connect_contests c join contests l on l.id=c.id
where c.paid_vote_kobo <> l.vote_price_ngn * 100;"
