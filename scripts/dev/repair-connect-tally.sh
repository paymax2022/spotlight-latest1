#!/usr/bin/env bash
# Replays credited paid purchases that never reached the connect tally.
#
# The mirror is idempotent on the payment reference (uq_connect_votes_idem), so
# running this repeatedly is safe: an already-counted purchase is skipped.
#
# Use when the mirror was skipped — a purchase made before the bridge existed, or
# one whose log line reads "connect tally mirror skipped".
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH=/usr/local/bin:/usr/bin:/bin
# Target the database given in DATABASE_URL, falling back to the local one.
# Without the override this script could only ever repair the LOCAL database,
# which is not where the gap it exists to fix would actually occur.
DB="${DATABASE_URL:-$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)}"

echo "── credited purchases missing from the connect tally ────"
psql "$DB" -P pager=off -c "
select t.payment_reference, t.total_votes_to_credit as votes, t.amount_expected as naira,
       t.voter_email, c.title
from vote_transactions t
join connect_contests c on c.id = t.contest_id
where t.vote_credit_status = 'credited'
  and t.voter_user_id is not null
  and not exists (
    select 1 from connect_votes v
     where v.idempotency_key = 'connect-tally:' || t.payment_reference)
order by t.created_at;"

echo "── replaying ───────────────────────────────────────────"
# amount_expected is NAIRA on vote_transactions; connect_votes.amount_kobo is
# minor units. The contestant must be on the contest, mirroring the bridge's own
# roster guard so a repair cannot create a tally the API would have refused.
psql "$DB" -v ON_ERROR_STOP=1 -P pager=off -c "
insert into connect_votes
  (contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key, ledger_ref)
select t.contest_id, t.voter_user_id, t.contestant_id::text, true,
       t.total_votes_to_credit, round(t.amount_expected * 100)::bigint,
       'connect-tally:' || t.payment_reference, t.payment_reference
from vote_transactions t
where t.vote_credit_status = 'credited'
  and t.voter_user_id is not null
  and t.total_votes_to_credit > 0
  and t.amount_expected > 0
  and t.payment_status is distinct from 'refunded'
  -- connect_votes.contest_id FKs connect_contests while vote_transactions.contest_id
  -- FKs the legacy contests table. One row whose contest exists in only the legacy
  -- plane raises 23503, and ON CONFLICT does not cover a FK violation, so under
  -- ON_ERROR_STOP the whole batch aborts and repairs nothing.
  and exists (select 1 from connect_contests cc where cc.id = t.contest_id)
  -- ListRoster filters on connect_contest_id alone; matching the legacy
  -- contest_id would write a row the roster can never display.
  and exists (
    select 1 from contestants ct
     where ct.id = t.contestant_id
       and ct.connect_contest_id = t.contest_id)
  and not exists (
    select 1 from connect_votes v
     where v.idempotency_key = 'connect-tally:' || t.payment_reference)
on conflict (idempotency_key) where idempotency_key is not null do nothing;"

echo "── remaining gaps (expect 0) ───────────────────────────"
# Must use the SAME predicate as the INSERT above. It previously did not, so a
# correct run counted rows the INSERT deliberately skips and reported a non-zero
# remainder — a successful repair that read as a failed one.
psql "$DB" -t -A -c "
select count(*) from vote_transactions t
where t.vote_credit_status='credited' and t.voter_user_id is not null
  and t.total_votes_to_credit > 0 and t.amount_expected > 0
  and t.payment_status is distinct from 'refunded'
  and exists (select 1 from connect_contests cc where cc.id = t.contest_id)
  and exists (select 1 from contestants ct where ct.id=t.contestant_id
              and ct.connect_contest_id = t.contest_id)
  and not exists (select 1 from connect_votes v
                  where v.idempotency_key='connect-tally:'||t.payment_reference);"
