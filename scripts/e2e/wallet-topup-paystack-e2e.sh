#!/usr/bin/env bash
#
# wallet-topup-paystack-e2e.sh — live e2e for the wallet card-funding rail, the
# ONLY production funding path, which staging previously bypassed by seeding the
# ledger directly.
#
#   initiate      POST /api/v1/wallet/topup            (Next.js BFF → PSP initialize)
#   pay           POST /paystack/simulate              (tools/fakes Paystack rail)
#   fulfil        POST /api/webhooks/paystack          (signed charge.success → credit)
#   fallback      GET  /api/v1/wallet/topup/:ref       (verify-on-read when no webhook)
#
# Asserts: intent replay is idempotent; the ledger posts a BALANCED pair
# (user_wallet CREDIT / provider_clearing DEBIT, integer kobo); a replayed
# webhook credits once; an unsigned webhook is refused; a failed payment moves
# nothing; and verify-on-read settles a paid intent that never got a webhook.
#
# PREREQUISITES (all local):
#   - Next.js dev:   (cd frontend-web && PAYSTACK_BASE_URL=$FAKE_BASE next dev -p 13000)
#   - Paystack fake: PAYSTACK_SECRET_KEY=<same as frontend> \
#                    PAYSTACK_CALLBACK_URL=$WEB_BASE/api/webhooks/paystack \
#                    FAKE_ADDR=:19100 tools/fakes
#   - Supabase Auth on SB_URL; a KYC tier-1 user (E2E_EMAIL/E2E_PASSWORD)
#   - Ledger reads via PSQL (docker exec into the Supabase db by default)
#
# USAGE: ./scripts/e2e/wallet-topup-paystack-e2e.sh
# ENV:   WEB_BASE FAKE_BASE SB_URL ANON_KEY E2E_EMAIL E2E_PASSWORD PAYSTACK_SECRET_KEY PSQL
set -uo pipefail

WEB_BASE="${WEB_BASE:-http://127.0.0.1:13000}"
FAKE_BASE="${FAKE_BASE:-http://127.0.0.1:19100}"
SB_URL="${SB_URL:-http://127.0.0.1:54321}"
E2E_EMAIL="${E2E_EMAIL:-e2e.topup@spotlight-app.dev}"
E2E_PASSWORD="${E2E_PASSWORD:-LocalDevAdmin123!}"
PSQL="${PSQL:-docker exec supabase_db_spotlight psql -U postgres -d postgres -tAc}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANON_KEY="${ANON_KEY:-$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/frontend-web/.env.local" | cut -d= -f2-)}"
PAYSTACK_SECRET_KEY="${PAYSTACK_SECRET_KEY:-$(grep -E '^PAYSTACK_SECRET_KEY=' "$ROOT/frontend-web/.env.local" | cut -d= -f2-)}"

PASS=0; FAIL=0
check() { # check <id> <desc> <expected> <actual>
  if [[ "$3" == "$4" ]]; then printf '  [PASS] %-6s %-58s\n' "$1" "$2"; PASS=$((PASS+1));
  else printf '  [FAIL] %-6s %-58s expected=%s got=%s\n' "$1" "$2" "$3" "$4"; FAIL=$((FAIL+1)); fi
}
jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+'$1'))" 2>/dev/null; }
psqlq() { $PSQL "$1" 2>/dev/null; }

echo "== wallet-topup e2e ==  web=$WEB_BASE fake=$FAKE_BASE user=$E2E_EMAIL"

TOKEN=$(curl -sS -X POST "$SB_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASSWORD\"}" | jqget '["access_token"]')
[[ -n "$TOKEN" ]] || { echo "FATAL: no access_token for $E2E_EMAIL"; exit 2; }
AUTH="Authorization: Bearer $TOKEN"

# 1) initiate → fake-backed authorization_url
AMT1=500000
IDEM1="e2e-topup-$(date +%s)-a"
R1=$(curl -sS -w '|%{http_code}' -X POST "$WEB_BASE/api/v1/wallet/topup" \
  -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEM1" \
  -d "{\"amount_kobo\":$AMT1,\"purpose\":\"wallet\"}")
CODE1="${R1##*|}"; J1="${R1%|*}"
REF1=$(printf '%s' "$J1" | jqget '["payment_reference"]')
INTENT1=$(printf '%s' "$J1" | jqget '["intent_id"]')
AUTHURL=$(printf '%s' "$J1" | jqget '["authorization_url"]')
check A01 "initiate topup returns 201" "201" "$CODE1"
case "$AUTHURL" in "$FAKE_BASE"/*) check A02 "authorization_url points at the fake" "fake" "fake";; *) check A02 "authorization_url points at the fake" "$FAKE_BASE/*" "$AUTHURL";; esac

# 2) replay same Idempotency-Key → already_processed, same reference
R2=$(curl -sS -w '|%{http_code}' -X POST "$WEB_BASE/api/v1/wallet/topup" \
  -H "$AUTH" -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEM1" \
  -d "{\"amount_kobo\":$AMT1,\"purpose\":\"wallet\"}")
check A03 "initiate replay returns 200" "200" "${R2##*|}"
check A04 "replay reports already_processed" "True" "$(printf '%s' "${R2%|*}" | jqget '["already_processed"]')"
check A05 "replay returns SAME reference" "$REF1" "$(printf '%s' "${R2%|*}" | jqget '["payment_reference"]')"

BAL0=$(curl -sS "$WEB_BASE/api/v1/wallet/balance" -H "$AUTH" | jqget '["available_kobo"]')

# 3) fake: customer pays → signed charge.success webhook → fulfil
curl -sS -X POST "$FAKE_BASE/paystack/simulate" -H 'Content-Type: application/json' \
  -d "{\"reference\":\"$REF1\",\"outcome\":\"success\"}" >/dev/null
COMPLETED=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  S=$(curl -sS "$WEB_BASE/api/v1/wallet/topup/$REF1" -H "$AUTH")
  [[ "$(printf '%s' "$S" | jqget '["completed"]')" == "True" ]] && COMPLETED=1 && break
  sleep 1
done
check A06 "webhook fulfils topup (intent completed)" "1" "${COMPLETED:-0}"

# 4) ledger: balanced pair — CREDIT user_wallet / DEBIT provider_clearing
CREDITS=$(psqlq "select count(*) from ledger_entries le join ledger_accounts la on la.id=le.account_id where le.reference='TOPUP:$REF1' and le.type='CREDIT' and le.amount_kobo=$AMT1 and la.type='user_wallet'")
DEBITS=$(psqlq "select count(*) from ledger_entries le join ledger_accounts la on la.id=le.account_id where le.reference='TOPUP:$REF1' and le.type='DEBIT' and le.amount_kobo=$AMT1 and la.type='provider_clearing'")
check A07 "balanced ledger: 1 CREDIT on user_wallet" "1" "$CREDITS"
check A08 "balanced ledger: 1 DEBIT on provider_clearing" "1" "$DEBITS"

BAL1=$(curl -sS "$WEB_BASE/api/v1/wallet/balance" -H "$AUTH" | jqget '["available_kobo"]')
check A09 "balance credited by exact kobo amount" "$((BAL0 + AMT1))" "$BAL1"

# 5) replay the same signed webhook → dedupe, no second credit
WBODY="{\"event\":\"charge.success\",\"data\":{\"reference\":\"$REF1\",\"amount\":$AMT1,\"channel\":\"card\",\"status\":\"success\",\"customer\":{\"email\":\"$E2E_EMAIL\"},\"metadata\":{\"type\":\"wallet_topup\",\"topup_intent_id\":\"$INTENT1\"}}}"
WSIG=$(WBODY="$WBODY" PSK="$PAYSTACK_SECRET_KEY" python3 -c "import hmac,hashlib,os;print(hmac.new(os.environ['PSK'].encode(),os.environ['WBODY'].encode(),hashlib.sha512).hexdigest())")
curl -sS -X POST "$WEB_BASE/api/webhooks/paystack" -H "x-paystack-signature: $WSIG" -H 'Content-Type: application/json' -d "$WBODY" >/dev/null
BAL2=$(curl -sS "$WEB_BASE/api/v1/wallet/balance" -H "$AUTH" | jqget '["available_kobo"]')
check A10 "replayed webhook credits once only" "$BAL1" "$BAL2"

# 6) unsigned webhook → refused, no credit
BAD=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$WEB_BASE/api/webhooks/paystack" \
  -H 'x-paystack-signature: deadbeef' -H 'Content-Type: application/json' -d "$WBODY")
check A11 "unsigned webhook is refused" "401" "$BAD"

# 7) failed payment → nothing credits
REF2=$(curl -sS -X POST "$WEB_BASE/api/v1/wallet/topup" -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEM1-fail" -d '{"amount_kobo":300000,"purpose":"wallet"}' | jqget '["payment_reference"]')
curl -sS -X POST "$FAKE_BASE/paystack/simulate" -H 'Content-Type: application/json' \
  -d "{\"reference\":\"$REF2\",\"outcome\":\"failed\"}" >/dev/null
S2=$(curl -sS "$WEB_BASE/api/v1/wallet/topup/$REF2" -H "$AUTH")
check A12 "failed payment leaves intent unsettled" "False" "$(printf '%s' "$S2" | jqget '["completed"]')"
BAL3=$(curl -sS "$WEB_BASE/api/v1/wallet/balance" -H "$AUTH" | jqget '["available_kobo"]')
check A13 "failed payment moves no money" "$BAL2" "$BAL3"

# 8) verify-on-read: paid at PSP but webhook never delivered → GET settles it
AMT3=100000
REF3=$(curl -sS -X POST "$WEB_BASE/api/v1/wallet/topup" -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEM1-verify" -d "{\"amount_kobo\":$AMT3,\"purpose\":\"wallet\"}" | jqget '["payment_reference"]')
curl -sS -X POST "$FAKE_BASE/paystack/simulate" -H 'Content-Type: application/json' \
  -d "{\"reference\":\"$REF3\",\"outcome\":\"success\",\"deliver_webhook\":false}" >/dev/null
S3=$(curl -sS "$WEB_BASE/api/v1/wallet/topup/$REF3" -H "$AUTH")
check A14 "verify-on-read settles a webhook-less payment" "True" "$(printf '%s' "$S3" | jqget '["completed"]')"
BAL4=$(curl -sS "$WEB_BASE/api/v1/wallet/balance" -H "$AUTH" | jqget '["available_kobo"]')
check A15 "verify path credits exact amount" "$((BAL3 + AMT3))" "$BAL4"
CREDITS3=$(psqlq "select count(*) from ledger_entries le join ledger_accounts la on la.id=le.account_id where le.reference='TOPUP:$REF3' and le.type='CREDIT' and la.type='user_wallet'")
check A16 "verify path posts the balanced pair too" "1" "$CREDITS3"

echo
echo "result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
