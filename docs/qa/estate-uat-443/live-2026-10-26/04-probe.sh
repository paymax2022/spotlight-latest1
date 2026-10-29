#!/usr/bin/env bash
# API_LIVE probe: FEATURE_ESTATE_GUARD_GRANTS enforcement over HTTP against the
# running dev backend (port 8093) and the seeded UAT Gate Estate Alpha.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8093}"
EST=0a1e5701-0000-4000-8000-000000000001
GATE=0a1e5701-0000-4000-8000-000000000101
T=/tmp/estate-uat-live/tokens
W=/tmp/estate-uat-live
OUT="$W/probe.out"
: > "$OUT"

PASS=0; FAIL=0
jwt() { cat "$T/$1.jwt"; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }

jget() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(v==null?"":v)' "$1" "$2"; }

# call <label> <METHOD> <path> [body] -> sets CODE, writes $W/resp.json
call() {
  local label=$1 method=$2 path=$3 body=${4:-}
  if [ -n "$body" ]; then
    CODE=$(curl -sS -m 30 -o "$W/resp.json" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $(jwt "$label")" -H 'Content-Type: application/json' -d "$body")
  else
    CODE=$(curl -sS -m 30 -o "$W/resp.json" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $(jwt "$label")")
  fi
}

# expect <want_code> <who> <METHOD> <path> [body] <description>
expect() {
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  local msg; msg=$(jget "$W/resp.json" error)
  printf '%-4s want=%s got=%s  [%s as %s] %s\n' \
    "$( [ "$CODE" = "$want" ] && echo PASS || echo FAIL )" "$want" "$CODE" "$desc" "$who" "${msg:+— $msg}" | tee -a "$OUT"
  if [ "$CODE" = "$want" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

note "=== estate guard-grants API_LIVE probe @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE"
note "estate=$EST guard=$(uid guard) resident=$(uid resident) admin=$(uid admin)"

ADMIN_UID=$(uid admin); GUARD_UID=$(uid guard); RES_UID=$(uid resident)

note "--- 0. reset: revoke any leftover grant so the ungranted baseline is real"
call admin DELETE "/api/finance/estate/$EST/staff-grants/$GUARD_UID/gate_officer"
note "reset revoke -> HTTP $CODE ($(head -c 120 "$W/resp.json"))"

note "--- 1. flag ON: a member with no grant is refused the gate surface"
expect 403 resident GET  "/api/finance/estate/$EST/guard/lookup?numeric_code=000000" "unguarded member lookup"
expect 403 guard   GET  "/api/finance/estate/$EST/guard/lookup?numeric_code=000000" "ungranted guard lookup"
expect 403 guard   POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"000000\",\"gate_id\":\"$GATE\"}" "ungranted guard checkin"

note "--- 2. estate_admin delegates gate_officer"
expect 201 admin POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$GUARD_UID\",\"role\":\"gate_officer\"}" "grant gate_officer"
GRANT_ID=$(jget "$W/resp.json" id); note "grant id=$GRANT_ID"
expect 200 admin GET "/api/finance/estate/$EST/staff-grants" "admin lists grants"
note "grants body: $(head -c 400 "$W/resp.json")"

note "--- 3. non-admin cannot delegate (fail closed)"
expect 403 resident POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$GUARD_UID\",\"role\":\"gate_officer\"}" "member tries to grant"

note "--- 4. granted officer now reaches the gate surface"
expect 200 guard GET "/api/finance/estate/$EST/gates" "officer lists gates (member-visible by design: assertResident)"
expect 200 guard GET "/api/finance/estate/$EST/guard/expected-visitors" "granted officer expected visitors (grant-gated)"

note "--- 5. estate_admin always passes"
expect 200 admin GET "/api/finance/estate/$EST/guard/expected-visitors" "admin expected visitors"

note "--- 6. visitor golden path through the granted guard"
VF=$(date -u +%Y-%m-%dT%H:%M:%SZ); VU=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+2H +%Y-%m-%dT%H:%M:%SZ)
expect 201 resident POST "/api/finance/estate/$EST/access-codes" \
  "{\"visitor_name\":\"Golden Path Guest\",\"code_type\":\"one_time\",\"valid_from\":\"$VF\",\"valid_until\":\"$VU\",\"max_uses\":2,\"purpose\":\"UAT live lane\"}" \
  "host issues one-time code"
CODE_ID=$(jget "$W/resp.json" id); NUM=$(jget "$W/resp.json" numeric_code); QR=$(jget "$W/resp.json" qr_code)
note "code id=$CODE_ID numeric=$NUM qr=$QR"
expect 200 guard GET "/api/finance/estate/$EST/guard/lookup?numeric_code=$NUM" "guard resolves the code"
expect 201 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$NUM\",\"gate_id\":\"$GATE\"}" "guard admits visitor #1"
expect 201 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"qr_code\":\"$QR\",\"gate_id\":\"$GATE\"}" "guard admits visitor #2 (qr)"
expect 403 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$NUM\",\"gate_id\":\"$GATE\"}" "third admit denied (max_uses=2)"
expect 201 guard POST "/api/finance/estate/$EST/guard/checkout" "{\"code_id\":\"$CODE_ID\",\"gate_id\":\"$GATE\"}" "guard checks the visitor out"

note "--- 7. host-approval-gated code: guard must raise a request, host decides"
expect 201 resident POST "/api/finance/estate/$EST/access-codes" \
  "{\"visitor_name\":\"Approval Guest\",\"code_type\":\"one_time\",\"valid_from\":\"$VF\",\"valid_until\":\"$VU\",\"max_uses\":2,\"require_host_approval\":true,\"purpose\":\"UAT SP-02\"}" \
  "host issues approval-gated code"
APPROVED_ID=$(jget "$W/resp.json" id); APPROVED_NUM=$(jget "$W/resp.json" numeric_code)
note "gated code id=$APPROVED_ID numeric=$APPROVED_NUM (2 uses available, so a refusal here is the approval gate, not exhaustion)"
expect 403 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$APPROVED_NUM\",\"gate_id\":\"$GATE\"}" "admit without approval refused"
expect 201 guard POST "/api/finance/estate/$EST/guard/arrival-request" "{\"code_id\":\"$APPROVED_ID\",\"gate_id\":\"$GATE\"}" "guard raises arrival request"
RID=$(jget "$W/resp.json" arrival_request_id)
note "arrival request id=$RID"
expect 200 resident POST "/api/finance/estate/$EST/arrival-requests/$RID/decision" '{"approve":true}' "host approves arrival"
expect 201 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$APPROVED_NUM\",\"gate_id\":\"$GATE\"}" "admit after host approval"
expect 403 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$APPROVED_NUM\",\"gate_id\":\"$GATE\"}" "second admit refused: approval is consumed, one per visit"
expect 400 guard POST "/api/finance/estate/$EST/guard/arrival-request" "{\"code_id\":\"$CODE_ID\",\"gate_id\":\"$GATE\"}" "arrival request refused for a code that needs no approval"

note "--- 8. revocation cuts gate access immediately (grant-gated surfaces)"
expect 200 admin DELETE "/api/finance/estate/$EST/staff-grants/$GUARD_UID/gate_officer" "admin revokes gate_officer"
expect 403 guard POST "/api/finance/estate/$EST/guard/checkin" "{\"numeric_code\":\"$APPROVED_NUM\",\"gate_id\":\"$GATE\"}" "revoked guard checkin"
expect 403 guard GET "/api/finance/estate/$EST/guard/expected-visitors" "revoked guard expected visitors"
expect 403 guard GET "/api/finance/estate/$EST/guard/lookup?numeric_code=$APPROVED_NUM" "revoked guard lookup"

note "--- 9. expired grant is refused (past expires_at)"
expect 201 admin POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$GUARD_UID\",\"role\":\"gate_officer\",\"expires_at\":\"2026-01-01T00:00:00Z\"}" "grant with past expiry"
expect 403 guard GET "/api/finance/estate/$EST/guard/expected-visitors" "expired-grant officer expected visitors"
note "--- 10. future-dated grant is live until expires_at"
FUT=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+1H +%Y-%m-%dT%H:%M:%SZ)
expect 201 admin POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$GUARD_UID\",\"role\":\"gate_officer\",\"expires_at\":\"$FUT\"}" "grant expiring in 1h"
expect 200 guard GET "/api/finance/estate/$EST/guard/expected-visitors" "live-until-expiry officer expected visitors"

note "--- 11. estate_admin is not a delegable staff role"
expect 400 admin POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$RES_UID\",\"role\":\"estate_admin\"}" "attempt to grant estate_admin"

note "--- 12. caller-scoped estate discovery"
call guard GET "/api/finance/estate?limit=50"; note "guard sees: $(head -c 300 "$W/resp.json")"
call resident GET "/api/finance/estate?limit=50"; note "resident sees: $(head -c 300 "$W/resp.json")"

note "=== summary: PASS=$PASS FAIL=$FAIL"
