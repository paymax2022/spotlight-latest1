#!/usr/bin/env bash
# Referral × airtime end-to-end lane (local stack only).
#
#   referrer mints a code → referee signs up and attributes it → referee buys
#   ₦1,000 MTN airtime from the wallet → referrer sees Amount earned, Invited,
#   Activated and a withdrawable balance → referrer withdraws → wallet credited.
#
# Every assertion is a real HTTP call against the Go backend (BASE) plus a
# read-back of the database it wrote. Nothing is mocked except the airtime
# provider, which is the seeded `spotlight_sandbox` row in utility_providers.
#
# Usage: BASE=http://localhost:8097 bash e2e-referral-airtime.sh
#        SKIP_WITHDRAW=1 … leaves the earning withdrawable, for a manual app pass.
# Needs: local Supabase (supabase start), backend started with
#   FEATURE_REFERRALS_ENABLED=true FEATURE_REFERRAL_REWARDS_ENABLED=true
#   FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED=true
set -uo pipefail

BASE="${BASE:-http://localhost:8097}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_spotlight}"
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
: "${API_URL:?supabase status gave no API_URL — is the local stack up?}"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL $*"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else bad "$1 want=$3 got=$2"; fi; }
sql()  { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -c "$1"; }
idem() { uuidgen | tr 'A-Z' 'a-z'; }

STAMP=$(date -u +%Y%m%d%H%M%S)
PW="RefE2E-${STAMP}-pw!"

mkuser() { # email → user id
  curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PW\",\"email_confirm\":true}" | jq -r '.id'
}
token() { # email → access token
  curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PW\"}" | jq -r '.access_token'
}
call() { # method token path [json] → writes body to $OUT, echoes status
  local m=$1 t=$2 p=$3 d=${4:-}
  if [ -n "$d" ]; then
    curl -s -o "$OUT" -w '%{http_code}' -X "$m" "$BASE$p" -H "Authorization: Bearer $t" \
      -H 'Content-Type: application/json' -H "Idempotency-Key: $(idem)" -d "$d"
  else
    curl -s -o "$OUT" -w '%{http_code}' -X "$m" "$BASE$p" -H "Authorization: Bearer $t"
  fi
}
OUT=$(mktemp)

echo "== 1. identities (stamp $STAMP)"
R_EMAIL="ref-e2e-referrer-$STAMP@local.test"
E_EMAIL="ref-e2e-referee-$STAMP@local.test"
R_ID=$(mkuser "$R_EMAIL"); E_ID=$(mkuser "$E_EMAIL")
[ ${#R_ID} -eq 36 ] && ok "referrer created $R_ID" || bad "referrer create: $R_ID"
[ ${#E_ID} -eq 36 ] && ok "referee created $E_ID"  || bad "referee create: $E_ID"
# Verified KYC tier 1 on both: the referee's wallet spend and the referrer's
# withdraw are both tier-gated (fail-closed). Fixture, not product behaviour.
for u in "$R_ID:$R_EMAIL" "$E_ID:$E_EMAIL"; do
  sql "INSERT INTO user_profiles (id, email, kyc_tier, kyc_status) VALUES ('${u%%:*}','${u#*:}',1,'verified')
       ON CONFLICT (id) DO UPDATE SET kyc_tier=1, kyc_status='verified';" >/dev/null
done
R_TOK=$(token "$R_EMAIL"); E_TOK=$(token "$E_EMAIL")
[ "$R_TOK" != null ] && ok "referrer signed in" || bad "referrer sign-in"
[ "$E_TOK" != null ] && ok "referee signed in"  || bad "referee sign-in"

echo "== 2. referrer's code"
eq "GET /v1/referrals/me/dashboard (referrer)" "$(call GET "$R_TOK" /v1/referrals/me/dashboard)" 200
CODE=$(jq -r '.code' "$OUT")
[ ${#CODE} -eq 5 ] && ok "code minted $CODE" || bad "code: $(cat "$OUT")"
eq "invited before signup" "$(jq -r '.invited_count' "$OUT")" 0

echo "== 3. referee attributes the code"
eq "POST /v1/referrals/attribute" "$(call POST "$E_TOK" /v1/referrals/attribute "{\"code\":\"$CODE\"}")" 200
eq "attribution row → referrer" "$(sql "SELECT referrer_id FROM referral_attributions WHERE referred_user_id='$E_ID' AND is_house=false")" "$R_ID"
call GET "$R_TOK" /v1/referrals/me/dashboard >/dev/null
eq "invited after signup" "$(jq -r '.invited_count' "$OUT")" 1
eq "activated before any purchase" "$(jq -r '.activated_count' "$OUT")" 0

echo "== 4. fund referee wallet ₦5,000 (balanced journal, provider_clearing → wallet)"
sql "INSERT INTO ledger_accounts (type) SELECT 'provider_clearing' WHERE NOT EXISTS
       (SELECT 1 FROM ledger_accounts WHERE type='provider_clearing' AND user_id IS NULL AND group_id IS NULL);
     INSERT INTO ledger_accounts (user_id, type) SELECT '$E_ID','user_wallet' WHERE NOT EXISTS
       (SELECT 1 FROM ledger_accounts WHERE user_id='$E_ID' AND type='user_wallet');
     INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
       SELECT id,'DEBIT',500000,'ref-e2e-fund-$STAMP','ref-e2e-fund-$STAMP:debit' FROM ledger_accounts
        WHERE type='provider_clearing' AND user_id IS NULL AND group_id IS NULL;
     INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
       SELECT id,'CREDIT',500000,'ref-e2e-fund-$STAMP','ref-e2e-fund-$STAMP:credit' FROM ledger_accounts
        WHERE user_id='$E_ID' AND type='user_wallet';" >/dev/null
eq "GET /api/finance/wallet/balance (referee)" "$(call GET "$E_TOK" /api/finance/wallet/balance)" 200
echo "     referee wallet: $(jq -c . "$OUT")"

echo "== 5. referee buys ₦1,000 MTN airtime from the wallet"
BILLER=$(sql "SELECT id FROM utility_billers WHERE category='airtime' AND code='${AIRTIME_BILLER:-vtpass-mtn-airtime}'")
PRODUCT=$(sql "SELECT id FROM utility_products WHERE biller_id='$BILLER' LIMIT 1")
ST=$(call POST "$E_TOK" /api/finance/utilitybills/pay \
  "{\"category\":\"airtime\",\"biller_id\":\"$BILLER\",\"product_id\":\"$PRODUCT\",\"customer_reference\":\"08031234567\",\"amount_kobo\":100000,\"payment_source\":\"wallet\"}")
case "$ST" in 200|201) ok "POST /api/finance/utilitybills/pay ($ST)";; *) bad "pay status $ST: $(cat "$OUT")";; esac
TXN=$(jq -r '.transaction.id // .data.transaction.id' "$OUT")
echo "     transaction $TXN status $(jq -r '.transaction.status // .data.transaction.status' "$OUT")"
EARN=$(sql "SELECT spotlight_revenue_kobo FROM commission_earnings WHERE source_ref='$TXN'")
[ -n "$EARN" ] && [ "$EARN" -gt 0 ] && ok "commission_earnings row, Spotlight revenue $EARN kobo" || bad "no commission_earnings for $TXN"
WANT=$(( ${EARN:-0} * 2000 / 10000 ))

echo "== 6. referrer sees it — no app restart, no manual step"
eq "referral_rewards for the purchase" "$(sql "SELECT status||':'||reward_kobo FROM referral_rewards WHERE referred_user_id='$E_ID'")" "CREDITED:$WANT"
eq "reward ledger row is withdrawable" "$(sql "SELECT state||':'||amount_kobo FROM referral_reward_ledger WHERE beneficiary_id='$R_ID'")" "eligible:$WANT"
call GET "$R_TOK" /v1/referrals/me/dashboard >/dev/null
eq "dashboard lifetime_earned_kobo (Amount earned)" "$(jq -r '.lifetime_earned_kobo' "$OUT")" "$WANT"
eq "dashboard invited_count" "$(jq -r '.invited_count' "$OUT")" 1
eq "dashboard activated_count" "$(jq -r '.activated_count' "$OUT")" 1
eq "GET /api/finance/referral/my-rewards" "$(call GET "$R_TOK" /api/finance/referral/my-rewards)" 200
eq "my-rewards eligible_kobo" "$(jq -r '.eligible_kobo // .data.eligible_kobo' "$OUT")" "$WANT"
eq "GET /v1/referrals/me/referrals" "$(call GET "$R_TOK" '/v1/referrals/me/referrals?limit=100')" 200
eq "tracked invitee is activated" "$(jq -r '.referrals[0].active' "$OUT")" true
eq "GET /v1/referrals/me/earnings" "$(call GET "$R_TOK" '/v1/referrals/me/earnings?limit=20&offset=0')" 200
eq "activity shows the airtime reward" "$(jq -r '.earnings[0].module + ":" + (.earnings[0].reward_kobo|tostring)' "$OUT")" "utility:$WANT"

if [ -z "${SKIP_WITHDRAW:-}" ]; then
echo "== 7. referrer withdraws to wallet"
eq "GET /api/finance/referral/withdraw-eligible" "$(call GET "$R_TOK" /api/finance/referral/withdraw-eligible)" 200
eq "withdraw-eligible eligible_kobo" "$(jq -r '.eligible_kobo // .data.eligible_kobo' "$OUT")" "$WANT"
W_BEFORE=$(sql "SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
                FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
                WHERE a.user_id='$R_ID' AND a.type='user_wallet'")
eq "POST /api/finance/referral/withdraw" "$(call POST "$R_TOK" /api/finance/referral/withdraw '{}')" 200
eq "withdrawn_kobo" "$(jq -r '.withdrawn_kobo // .data.withdrawn_kobo' "$OUT")" "$WANT"
eq "remaining_eligible_kobo" "$(jq -r '.remaining_eligible_kobo // .data.remaining_eligible_kobo' "$OUT")" 0
W_AFTER=$(sql "SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
               FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
               WHERE a.user_id='$R_ID' AND a.type='user_wallet'")
eq "referrer wallet delta" "$((W_AFTER - W_BEFORE))" "$WANT"
eq "reward ledger row now paid" "$(sql "SELECT state FROM referral_reward_ledger WHERE beneficiary_id='$R_ID'")" paid
call POST "$R_TOK" /api/finance/referral/withdraw '{}' >/dev/null
eq "second withdraw moves nothing" "$(jq -r '.withdrawn_kobo // .data.withdrawn_kobo' "$OUT")" 0
eq "payout journal is balanced" "$(sql "SELECT SUM(CASE WHEN type IN ('CREDIT','REVERSAL_CREDIT') THEN amount_kobo ELSE -amount_kobo END) FROM ledger_entries WHERE reference IN (SELECT 'referral:payout:'||id FROM referral_reward_ledger WHERE beneficiary_id='$R_ID')")" 0
eq "withdraw audit event that moved money" "$(sql "SELECT count(*) FROM referral_engine_events WHERE event_type='referral_withdraw' AND user_id='$R_ID' AND (payload->>'withdrawn_kobo')::bigint > 0")" 1
eq "every withdraw request is audited (incl. the empty one)" "$(sql "SELECT count(*) FROM referral_engine_events WHERE event_type='referral_withdraw' AND user_id='$R_ID'")" 2
eq "commission-split credit audit event" "$(sql "SELECT count(*) FROM referral_engine_events WHERE event_type='commission_split_reward_credited' AND referrer_id='$R_ID'")" 1

else
  echo "== 7. skipped (SKIP_WITHDRAW set) — earning left withdrawable for a UI pass; password: $PW"
fi

echo
echo "RESULT PASS=$PASS FAIL=$FAIL (stamp $STAMP, referrer $R_ID, referee $E_ID, code $CODE)"
rm -f "$OUT"
[ "$FAIL" -eq 0 ]
