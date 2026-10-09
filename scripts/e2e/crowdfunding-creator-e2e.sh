#!/usr/bin/env bash
#
# crowdfunding-creator-e2e.sh — live e2e for the crowdfunding creator-management
# surface, which was dead on prod until the cf_* migrations landed.
#
# Covers the full creator lifecycle on the Go API:
#   submit → admin review (APPROVE) → owner PATCH/pause/resume →
#   feature-request/withdraw → wallet-funded contribution →
#   delete guard (funded campaign refuses) → delete draft succeeds.
#
# Plus the security gates: unauth 401, non-owner mutation refused (IDOR),
# contribute to a paused campaign refused, contribution replay idempotent.
#
# PREREQUISITES (all local):
#   - Go api running: (cd backend && set -a; source .env; set +a; APP_PORT=18160 ./bin/server)
#     with FEATURE_CROWDFUNDING_ENABLED=true
#   - Supabase Auth on SB_URL
#   - CREATOR_EMAIL/_PASSWORD: any verified user (creates + owns the campaign)
#   - CONTRIBUTOR_EMAIL/_PASSWORD: a KYC tier-1 user with funded wallet
#     (e.g. topped up via scripts/e2e/wallet-topup-paystack-e2e.sh)
#   - ADMIN_EMAIL/_PASSWORD: a super-admin/system-admin (crowdfunding.admin.*)
#
# USAGE: ./scripts/e2e/crowdfunding-creator-e2e.sh
set -uo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:18160}"
SB_URL="${SB_URL:-http://127.0.0.1:54321}"
CREATOR_EMAIL="${CREATOR_EMAIL:-qa-claude-test@spotlight.internal}"
CONTRIBUTOR_EMAIL="${CONTRIBUTOR_EMAIL:-e2e.topup@spotlight-app.dev}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@spotlight.internal}"
PASSWORD="${E2E_PASSWORD:-LocalDevAdmin123!}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANON_KEY="${ANON_KEY:-$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/frontend-web/.env.local" | cut -d= -f2-)}"

PASS=0; FAIL=0
check() {
  if [[ "$3" == "$4" ]]; then printf '  [PASS] %-6s %-58s\n' "$1" "$2"; PASS=$((PASS+1));
  else printf '  [FAIL] %-6s %-58s expected=%s got=%s\n' "$1" "$2" "$3" "$4"; FAIL=$((FAIL+1)); fi
}
jqget() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+'$1'))" 2>/dev/null; }
token() { curl -sS -X POST "$SB_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jqget '["access_token"]'; }

echo "== crowdfunding creator e2e == api=$API_BASE creator=$CREATOR_EMAIL contributor=$CONTRIBUTOR_EMAIL"

CT=$(token "$CREATOR_EMAIL"); UT=$(token "$CONTRIBUTOR_EMAIL"); AT=$(token "$ADMIN_EMAIL")
[[ -n "$CT" && -n "$UT" && -n "$AT" ]] || { echo "FATAL: token grant failed"; exit 2; }
CAUTH="Authorization: Bearer $CT"; UAUTH="Authorization: Bearer $UT"; AAUTH="Authorization: Bearer $AT"
CF="$API_BASE/api/finance/crowdfunding"
CFA="$API_BASE/api/crowdfunding/admin"
# Contribution idempotency keys are GLOBAL — a rerun must mint fresh ones or a
# replay resolves to a prior campaign's row and fails closed as a 409.
RUN="e2e-cf-$(date +%s)"

# 0) unauthenticated write is refused
UNAUTH=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CF/campaigns" -H 'Content-Type: application/json' -d '{}')
check B00 "unauthenticated create is refused" "401" "$UNAUTH"

# 1) creator submits a campaign for review
DEADLINE=$(date -u -v+30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
CREATE=$(curl -sS -w '|%{http_code}' -X POST "$CF/campaigns" -H "$CAUTH" -H 'Content-Type: application/json' -d "{
  \"type\":\"DONATION\",\"category\":\"education\",\"title\":\"E2E W10 Creator Lane\",
  \"summary\":\"e2e\",\"story\":\"e2e\",\"goalKobo\":5000000,\"deadline\":\"$DEADLINE\",
  \"submitForReview\":true,
  \"milestones\":[{\"title\":\"Phase 1\",\"targetKobo\":2500000}],
  \"budget\":[{\"label\":\"Materials\",\"amountKobo\":5000000}],
  \"rewardTiers\":[{\"title\":\"Thanks\",\"amountKobo\":50000,\"description\":\"shout-out\"}]
}")
CODE="${CREATE##*|}"; CJ="${CREATE%|*}"
CID=$(printf '%s' "$CJ" | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(d.get("campaignId") or d.get("id") or "")' 2>/dev/null)
check B01 "submit campaign → 201" "201" "$CODE"
[[ -n "$CID" && "$CID" != "None" ]] || { echo "FATAL: no campaign id in $CJ"; exit 2; }
echo "   campaign id: $CID"

RS=$(printf '%s' "$CJ" | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(d.get("status") or d.get("reviewStatus") or "")' 2>/dev/null)
check B02 "submitted campaign is PENDING_REVIEW" "PENDING_REVIEW" "$RS"

# 2) creator dashboard lists it
MINE=$(curl -sS "$CF/creator/campaigns" -H "$CAUTH")
check B03 "creator/campaigns lists own campaign" "True" "$(printf '%s' "$MINE" | python3 -c 'import json,sys;print(any(c["id"]=="'"$CID"'" for c in json.load(sys.stdin).get("data",[])))' 2>/dev/null)"

# 3) admin approves → review_status ACTIVE
DECIDE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CFA/campaigns/$CID/decision" -H "$AAUTH" -H 'Content-Type: application/json' -d '{"decision":"APPROVE","note":"e2e"}')
check B04 "admin APPROVE → 200" "200" "$DECIDE"

# 4) publish (heals legacy status col; idempotent)
PUB=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CF/campaigns/$CID/publish" -H "$CAUTH")
check B05 "owner publish → 200" "200" "$PUB"

# 5) owner PATCH (partial update)
UPD=$(curl -sS -w '|%{http_code}' -X PATCH "$CF/creator/campaigns/$CID" -H "$CAUTH" -H 'Content-Type: application/json' -d '{"title":"E2E W10 Creator Lane v2"}')
check B06 "owner PATCH → 200" "200" "${UPD##*|}"
check B07 "PATCH applied the new title" "E2E W10 Creator Lane v2" "$(printf '%s' "${UPD%|*}" | jqget '["title"]')"

# 6) IDOR: contributor cannot edit the creator's campaign
IDOR=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$CF/creator/campaigns/$CID" -H "$UAUTH" -H 'Content-Type: application/json' -d '{"title":"hijack"}')
check B08 "non-owner PATCH refused" "403" "$IDOR"

# 7) pause → contribute refused → resume → contribute succeeds
PAUSE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CF/creator/campaigns/$CID/pause" -H "$CAUTH")
check B09 "owner pause → 200" "200" "$PAUSE"
CONTRIB_PAUSED=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CF/campaigns/$CID/contribute" -H "$UAUTH" -H 'Content-Type: application/json' -d "{\"amount_kobo\":200000,\"idempotency_key\":\"$RUN-paused\"}")
check B10 "contribute to paused campaign → 409" "409" "$CONTRIB_PAUSED"
RESUME=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$CF/creator/campaigns/$CID/resume" -H "$CAUTH")
check B11 "owner resume → 200" "200" "$RESUME"

# 8) feature-request → withdraw
FR=$(curl -sS -w '|%{http_code}' -X POST "$CF/creator/campaigns/$CID/feature-request" -H "$CAUTH" -H 'Content-Type: application/json' -d '{"note":"e2e"}')
check B12 "feature-request → 201" "201" "${FR##*|}"
check B13 "feature-request is PENDING" "PENDING" "$(printf '%s' "${FR%|*}" | jqget '["status"]')"
WD=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$CF/creator/campaigns/$CID/feature-request" -H "$CAUTH")
check B14 "withdraw feature-request → 200" "200" "$WD"

# 9) wallet-funded contribution (escrow + 90/10 settlement)
CON=$(curl -sS -w '|%{http_code}' -X POST "$CF/campaigns/$CID/contribute" -H "$UAUTH" -H 'Content-Type: application/json' -d "{\"amount_kobo\":200000,\"idempotency_key\":\"$RUN-contrib\"}")
check B15 "contribute → 201" "201" "${CON##*|}"
CONID=$(printf '%s' "${CON%|*}" | jqget '["id"]')
CONSTATUS=$(printf '%s' "${CON%|*}" | jqget '["status"]')
# Contribute escrows then immediately settles the 90/10 split ("keep what you
# raise", no goal-gated hold) — the terminal state a creator sees is 'released'.
check B16 "contribution settles to released" "released" "$CONSTATUS"

# 10) idempotent replay of the same contribution key
CON2=$(curl -sS -w '|%{http_code}' -X POST "$CF/campaigns/$CID/contribute" -H "$UAUTH" -H 'Content-Type: application/json' -d "{\"amount_kobo\":200000,\"idempotency_key\":\"$RUN-contrib\"}")
check B17 "contribution replay → 200/201 same id" "$CONID" "$(printf '%s' "${CON2%|*}" | jqget '["id"]')"

# 11) funded campaign refuses delete; a never-funded draft deletes
DEL=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$CF/creator/campaigns/$CID" -H "$CAUTH")
check B18 "funded campaign refuses delete → 409" "409" "$DEL"

CREATE2=$(curl -sS -X POST "$CF/campaigns" -H "$CAUTH" -H 'Content-Type: application/json' -d "{
  \"type\":\"DONATION\",\"category\":\"education\",\"title\":\"E2E W10 Disposable Draft\",
  \"goalKobo\":100000,\"deadline\":\"$DEADLINE\",\"submitForReview\":false}")
CID2=$(printf '%s' "$CREATE2" | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(d.get("campaignId") or d.get("id") or "")' 2>/dev/null)
DEL2=$(curl -sS -X DELETE "$CF/creator/campaigns/$CID2" -H "$CAUTH")
check B19 "unfunded draft deletes" "True" "$(printf '%s' "$DEL2" | jqget '["deleted"]')"

# 12) creator analytics + stats still answer
ANA=$(curl -sS -o /dev/null -w '%{http_code}' "$CF/creator/campaigns/$CID/analytics" -H "$CAUTH")
check B20 "creator campaign analytics → 200" "200" "$ANA"
STATS=$(curl -sS -o /dev/null -w '%{http_code}' "$CF/creator/stats" -H "$CAUTH")
check B21 "creator stats → 200" "200" "$STATS"

echo
echo "result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
