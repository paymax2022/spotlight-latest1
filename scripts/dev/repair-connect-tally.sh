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
DB=$(grep -m1 '^DATABASE_URL=' backend/.env | cut -d= -f2-)

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
  and exists (
    select 1 from contestants ct
     where ct.id = t.contestant_id
       and (ct.connect_contest_id = t.contest_id or ct.contest_id = t.contest_id))
  and not exists (
    select 1 from connect_votes v
     where v.idempotency_key = 'connect-tally:' || t.payment_reference)
on conflict (idempotency_key) where idempotency_key is not null do nothing;"

echo "── remaining gaps (expect 0) ───────────────────────────"
psql "$DB" -t -A -c "
select count(*) from vote_transactions t
where t.vote_credit_status='credited' and t.voter_user_id is not null
  and t.total_votes_to_credit > 0 and t.amount_expected > 0
  and exists (select 1 from contestants ct where ct.id=t.contestant_id
              and (ct.connect_contest_id=t.contest_id or ct.contest_id=t.contest_id))
  and not exists (select 1 from connect_votes v
                  where v.idempotency_key='connect-tally:'||t.payment_reference);"
