#!/usr/bin/env bash
# API_LIVE probe — estate profile, governance history, role-scoped invites and ownership transfer
# (Phase 2.3, estate-a M02: EST-UAT-0021..0024, 0026..0028, 0030..0032, 0035, 0036).
#
# Drives the Go backend on :8095 (see 03-run-server.sh) with FEATURE_ESTATE_LIFECYCLE_ENABLED and
# FEATURE_ESTATE_VERIFICATION_REQUIRED on, so the platform review queue and the pending->active path
# are reachable over HTTP rather than only from Go tests. Every estate this lane creates is closed
# again in section 8, so the shared local database keeps no live test estates.
#
# Run from anywhere:  bash docs/qa/estate-uat-443/live-2026-10-27/07-probe-profile.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8095}"
W=/tmp/estate-uat-live
T="$W/tokens"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$DIR/probe-profile.out}"
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

# want <description> <value> <expected> — records a value read out of a response
want() {
  local ok=PASS; [ "$2" = "$3" ] || ok=FAIL
  printf '%-4s %s — got "%s" want "%s"\n' "$ok" "$1" "$2" "$3" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# wantsub <description> <pattern> — the last response body must contain the pattern
wantsub() {
  local ok=PASS; grep -q -- "$2" "$W/resp.json" || ok=FAIL
  printf '%-4s %s — body %s "%s"\n' "$ok" "$1" "$( [ "$ok" = PASS ] && echo contains || echo MISSING )" "$2" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

ADMIN=$(uid admin); RES=$(uid resident); GUARD=$(uid guard); OUTSIDER=$(uid nobody)
STAMP=$(date -u +%Y%m%d%H%M%S)
NAME_A="UAT Profile Estate A $STAMP"
ADDR_A="17 Adeyemi Close, Ikate, Lekki, Lagos"
NAME_X="UAT Rejected Twin X $STAMP"
ADDR_X="9 Unverified Crescent, Ikeja GRA, Lagos"
FUTURE=$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+2H +%Y-%m-%dT%H:%M:%SZ)
LONG_NOTICE=$(head -c 2001 /dev/zero | tr '\0' 'n')

note "=== estate profile / ownership API_LIVE probe @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE"
note "admin=$ADMIN resident=$RES guard=$GUARD outsider=$OUTSIDER run-id=$STAMP"

note "--- 1. 0021/0022: create validation, and an application is pending rather than live"
expect 400 admin POST "/api/finance/estate" "{\"address\":\"$ADDR_A\"}" "create with no name"
expect 400 admin POST "/api/finance/estate" "{\"name\":\"a\",\"address\":\"$ADDR_A\"}" "create with a 1-character name"
expect 400 admin POST "/api/finance/estate" "{\"name\":\"   \",\"address\":\"$ADDR_A\"}" "create with a whitespace-only name"
expect 400 admin POST "/api/finance/estate" "{\"name\":\"$NAME_A\",\"address\":\"$ADDR_A\",\"timezone\":\"Mars/Phobos\"}" "create with an unknown timezone"
expect 201 admin POST "/api/finance/estate" "{\"name\":\"$NAME_A\",\"address\":\"$ADDR_A\"}" "create estate"
E1=$(jget "$W/resp.json" id)
if [ -z "$E1" ]; then note "ABORT — no estate id"; exit 1; fi
want "1a a new estate is pending, not live" "$(jget "$W/resp.json" status)" "pending"
want "1b the timezone default is the platform zone" "$(jget "$W/resp.json" timezone)" "Africa/Lagos"
want "1c the creator is the estate owner" "$(jget "$W/resp.json" admin_id)" "$ADMIN"
note "estate under test: $E1"

note "--- 2. 0024/0029: nothing on a pending estate can be written until the platform publishes it"
expect 423 admin PATCH "/api/finance/estate/$E1/info" '{"timezone":"Europe/London"}' "profile write on a pending estate"
wantsub "2a refused with the machine-readable status" '"estate_status":"pending"'
expect 423 admin POST "/api/finance/estate/$E1/residents" "{\"user_id\":\"$OUTSIDER\",\"unit\":\"A-1\"}" "any estate write on a pending estate"

note "--- 3. 0024/0026: the review queue is reviewer-only and publishing is an audited transition"
expect 403 resident GET "/api/finance/estate-admin/estates?status=pending" "review queue as a plain member (estate.admin.lifecycle RBAC)"
expect 400 admin GET "/api/finance/estate-admin/estates?status=archived" "review queue with an unknown status"
expect 200 admin GET "/api/finance/estate-admin/estates?status=pending" "review queue as a granted reviewer"
wantsub "3a the new application is in the queue" "$E1"
expect 400 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"approve","reason":"looks fine to me"}' "unknown lifecycle action"
expect 400 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"verify","reason":"ok"}' "verify with a too-short reason"
expect 200 admin GET "/api/finance/estate-admin/estates/$E1" "a rejected transition left the estate pending"
want "3b still pending after the refused attempts" "$(jget "$W/resp.json" status)" "pending"
expect 409 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"suspend","reason":"a pending estate cannot be suspended"}' "suspend straight from pending"
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"verify","reason":"registration documents and address checked"}' "publish / verify the estate"
want "3c the verified estate is active" "$(jget "$W/resp.json" status)" "active"
expect 200 admin PATCH "/api/finance/estate/$E1/info" '{"notice":"Welcome — management office hours are 09:00-16:00."}' "profile write works once published"

note "--- 4. 0023/0027: a normalised twin is reviewed instead of going live; a rejection stops blocking"
expect 201 admin POST "/api/finance/estate" "{\"name\":\"  uat   profile   estate A $STAMP  \",\"address\":\"$ADDR_A\"}" "create a whitespace/case twin of the live estate"
E2=$(jget "$W/resp.json" id)
want "4a the twin is flagged duplicate_suspected" "$(jget "$W/resp.json" duplicate_suspected)" "true"
want "4b the twin is held pending, never published" "$(jget "$W/resp.json" status)" "pending"
expect 200 admin GET "/api/finance/estate-admin/estates?status=pending" "pending queue after the twin"
wantsub "4c the twin is in the review queue" "$E2"
expect 400 admin POST "/api/finance/estate-admin/estates/$E2/lifecycle" '{"action":"reject","reason":"abc"}' "reject with a too-short reason"
expect 200 admin POST "/api/finance/estate-admin/estates/$E2/lifecycle" '{"action":"reject","reason":"duplicate of a live estate, application refused"}' "reject the twin"
want "4d a rejected estate is closed" "$(jget "$W/resp.json" status)" "closed"

expect 201 admin POST "/api/finance/estate" "{\"name\":\"$NAME_X\",\"address\":\"$ADDR_X\"}" "create a second estate to reject first"
EX=$(jget "$W/resp.json" id)
expect 200 admin POST "/api/finance/estate-admin/estates/$EX/lifecycle" '{"action":"reject","reason":"documents did not match the address"}' "reject it"
expect 201 admin POST "/api/finance/estate" "{\"name\":\"$NAME_X\",\"address\":\"$ADDR_X\"}" "re-apply over the rejected estate"
E3=$(jget "$W/resp.json" id)
want "4e a rejected application does not block a real one" "$(jget "$W/resp.json" duplicate_suspected)" ""
expect 200 admin POST "/api/finance/estate-admin/estates/$E3/lifecycle" '{"action":"verify","reason":"re-application checked and approved"}' "publish the re-application (used as the wrong-estate path in section 7)"

note "--- 5. 0030/0031/0036: profile reads are membership-scoped, writes are admin-only and bounded"
expect 403 guard GET "/api/finance/estate/$E1/info" "a non-member cannot read the profile (0030 partitioning)"
expect 403 guard PATCH "/api/finance/estate/$E1/info" '{"notice":"outsider write"}' "a non-member cannot write the profile"
expect 403 guard GET "/api/finance/estate/00000000-0000-4000-8000-000000000000/info" "an unknown estate is not readable by anyone"
expect 400 admin PATCH "/api/finance/estate/not-a-uuid/info" '{"notice":"x"}' "malformed estate id"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"timezone":"Not/AZone"}' "unknown timezone"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"timezone":"   "}' "blank timezone"
expect 200 admin PATCH "/api/finance/estate/$E1/info" '{"timezone":"Africa/Nairobi"}' "valid IANA timezone"
want "5a the timezone persisted" "$(jget "$W/resp.json" timezone)" "Africa/Nairobi"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"branding":{"theme":"dark"}}' "branding key outside the allow-list"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"branding":{"primary_color":"red"}}' "branding colour is not #rrggbb"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"branding":{"logo_url":123}}' "branding value is not a string"
expect 400 admin PATCH "/api/finance/estate/$E1/info" '{"branding":{"logo_url":"ftp://mirror.example/logo.png"}}' "branding url scheme refused"
expect 200 admin PATCH "/api/finance/estate/$E1/info" '{"branding":{"logo_url":"https://cdn.example.test/a.png","primary_color":"#1f2d3e"}}' "valid branding"
want "5b branding colour stored" "$(jget "$W/resp.json" branding.primary_color)" "#1f2d3e"
expect 400 admin PATCH "/api/finance/estate/$E1/info" "{\"notice\":\"$LONG_NOTICE\"}" "notice over the 2000-character limit"
expect 200 admin PATCH "/api/finance/estate/$E1/info" '{"branding":null}' "branding cleared back to defaults"
expect 200 admin PATCH "/api/finance/estate/$E1/info" '{"timezone":"Africa/Lagos"}' "reset the zone for the rest of the run"

note "--- 6. 0028: invite codes carry a role; a resident code joins, and no code demotes an owner"
expect 403 resident POST "/api/finance/estate/$E1/invite-codes" "{\"max_uses\":2,\"expires_at\":\"$FUTURE\",\"role\":\"estate_admin\"}" "a non-member cannot mint a manager code"
expect 400 admin POST "/api/finance/estate/$E1/invite-codes" "{\"max_uses\":2,\"expires_at\":\"$FUTURE\",\"role\":\"guard\"}" "unknown invite role refused"
expect 400 admin POST "/api/finance/estate/$E1/invite-codes" "{\"expires_at\":\"$FUTURE\"}" "invite without max_uses"
expect 201 admin POST "/api/finance/estate/$E1/invite-codes" "{\"max_uses\":3,\"expires_at\":\"$FUTURE\",\"role\":\"estate_admin\"}" "manager code"
want "6a the manager code carries the manager role" "$(jget "$W/resp.json" role)" "estate_admin"
MGR=$(jget "$W/resp.json" code)
expect 201 admin POST "/api/finance/estate/$E1/invite-codes" "{\"max_uses\":3,\"expires_at\":\"$FUTURE\"}" "default-role code"
want "6b an omitted role defaults to resident" "$(jget "$W/resp.json" role)" "resident"
RES_CODE=$(jget "$W/resp.json" code)
expect 201 resident POST "/api/finance/estate/join/invite" "{\"code\":\"$RES_CODE\"}" "a member joins with the resident code"
want "6c the resident code grants resident" "$(jget "$W/resp.json" role)" "resident"
expect 403 resident GET "/api/finance/estate/$E1/admin/config/history?column=rules" "a resident-code member gains no admin surface"
expect 200 resident GET "/api/finance/estate/$E1/info" "the joined member reads the profile"
want "6d members see the estate's timezone" "$(jget "$W/resp.json" timezone)" "Africa/Lagos"
expect 201 admin POST "/api/finance/estate/join/invite" "{\"code\":\"$RES_CODE\"}" "the owner redeems a resident code"
want "6e a resident code cannot demote the owner" "$(jget "$W/resp.json" role)" "estate_admin"
expect 201 nobody POST "/api/finance/estate/join/invite" "{\"code\":\"$MGR\"}" "outsider redeems the manager code"
want "6f the manager code grants estate_admin" "$(jget "$W/resp.json" role)" "estate_admin"
expect 200 nobody GET "/api/finance/estate/$E1/admin/config/history?column=rules" "the promoted manager holds the admin privilege"

note "--- 7. 0025/0032: governance rules are versioned by the database, not by the caller"
expect 400 admin GET "/api/finance/estate/$E1/admin/config/history?column=nonsense" "unknown config column is a 400, not a 500"
expect 200 admin GET "/api/finance/estate/$E1/admin/config/history?column=subscription_plan" "subscription history is empty until a plan is written"
want "7a no phantom revision for an untouched column" "$(jget "$W/resp.json" data.0.column_name)" ""
expect 403 resident PUT "/api/finance/estate/$E1/admin/rules" '{"dues_due_day":9}' "a resident member cannot write rules"
expect 200 admin PUT "/api/finance/estate/$E1/admin/rules" '{"dues_due_day":5,"late_fee_kobo":50000}' "first governance rule write"
expect 200 admin PUT "/api/finance/estate/$E1/admin/rules" '{"dues_due_day":7,"late_fee_kobo":75000}' "second governance rule write"
expect 200 admin GET "/api/finance/estate/$E1/admin/config/history?column=rules&limit=10" "revision history"
want "7b the newest revision is v2" "$(jget "$W/resp.json" data.0.version)" "2"
want "7c the newest rule value" "$(jget "$W/resp.json" data.0.value.dues_due_day)" "7"
want "7d v2 records the value it replaced" "$(jget "$W/resp.json" data.0.previous_value.dues_due_day)" "5"
want "7e history is newest-first" "$(jget "$W/resp.json" data.1.version)" "1"
want "7f v1 has no previous value" "$(jget "$W/resp.json" data.1.previous_value)" ""

note "--- 8. 0035: ownership moves only when the incoming owner accepts"
expect 400 admin POST "/api/finance/estate/$E1/owner-transfer" '{"to_user_id":"not-a-uuid","reason":"cleanup"}' "unparseable target is a 400, not a 500"
expect 400 admin POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$ADMIN\",\"reason\":\"self transfer\"}" "self transfer refused"
expect 403 admin POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$GUARD\",\"reason\":\"not a member\"}" "a non-member cannot be handed the estate"
expect 403 resident POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$ADMIN\",\"reason\":\"member cannot initiate\"}" "a plain member cannot open a handover"
expect 201 admin POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$RES\",\"reason\":\"handing over the estate on relocation\"}" "open the handover"
T1=$(jget "$W/resp.json" id)
want "8a opening is pending" "$(jget "$W/resp.json" status)" "pending"
expect 409 admin POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$OUTSIDER\",\"reason\":\"second offer\"}" "only one offer awaits a decision at a time"
expect 200 admin GET "/api/finance/estate/$E1/info" "profile after the request"
want "8b the request itself moved nothing" "$(jget "$W/resp.json" admin_id)" "$ADMIN"
expect 404 guard POST "/api/finance/estate/$E1/owner-transfer/00000000-0000-4000-8000-000000000000/decide" '{"accept":true,"note":"guessing ids"}' "decide an unknown transfer"
expect 400 guard POST "/api/finance/estate/$E1/owner-transfer/not-a-uuid/decide" '{"accept":true,"note":"malformed transfer id"}' "malformed transfer id"
expect 403 guard POST "/api/finance/estate/$E1/owner-transfer/$T1/decide" '{"accept":true,"note":"not a party"}' "an unrelated member cannot decide"
expect 403 admin POST "/api/finance/estate/$E1/owner-transfer/$T1/decide" '{"accept":true,"note":"owner accepts own offer"}' "the outgoing owner cannot accept"
expect 404 resident POST "/api/finance/estate/$E3/owner-transfer/$T1/decide" '{"accept":true,"note":"posted under the wrong estate"}' "a decision posted under another estate is refused"
expect 200 admin GET "/api/finance/estate/$E1/info" "the mis-pathed decision moved nothing"
want "8c ownership is still the outgoing owner's" "$(jget "$W/resp.json" admin_id)" "$ADMIN"
expect 400 admin GET "/api/finance/estate/$E1/owner-transfers?status=bogus" "unknown status filter is a 400, not a 500"
expect 200 admin GET "/api/finance/estate/$E1/owner-transfers" "the owner sees the estate's offers"
wantsub "8d the pending offer is listed" "$T1"
expect 200 resident POST "/api/finance/estate/$E1/owner-transfer/$T1/decide" '{"accept":true,"note":"accepting on behalf of the residents association"}' "the incoming owner accepts"
want "8e the accept is recorded accepted" "$(jget "$W/resp.json" status)" "accepted"
expect 200 admin GET "/api/finance/estate-admin/estates/$E1" "estate ownership after acceptance"
want "8f the estate itself changed hands" "$(jget "$W/resp.json" admin_id)" "$RES"
expect 200 admin GET "/api/finance/estate/$E1/info" "profile read after acceptance"
want "8g the profile reports the new owner" "$(jget "$W/resp.json" admin_id)" "$RES"

note "--- 8h. a decided transfer is final, and the demoted owner keeps no privileges"
expect 409 resident POST "/api/finance/estate/$E1/owner-transfer/$T1/decide" '{"accept":true,"note":"again"}' "re-deciding an accepted transfer"
expect 403 admin GET "/api/finance/estate/$E1/admin/config/history?column=rules" "the former owner no longer reads governance history"
expect 403 admin POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$RES\",\"reason\":\"take it back\"}" "the former owner cannot open a handover"
expect 403 admin PATCH "/api/finance/estate/$E1/info" '{"notice":"former owner"}' "the former owner cannot edit the notice"
expect 200 admin GET "/api/finance/estate/$E1/info" "the former owner is still a member"
expect 200 resident PATCH "/api/finance/estate/$E1/info" '{"notice":"New management: service charges move to the 10th."}' "the new owner edits the profile"
expect 201 resident POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$OUTSIDER\",\"reason\":\"offering the estate on\"}" "the new owner opens a handover"
T2=$(jget "$W/resp.json" id)
expect 200 nobody POST "/api/finance/estate/$E1/owner-transfer/$T2/decide" '{"accept":false,"note":"declining the offer"}' "the target declines"
want "8i a decline is recorded declined" "$(jget "$W/resp.json" status)" "declined"
expect 200 admin GET "/api/finance/estate-admin/estates/$E1" "ownership unchanged after the decline"
want "8j the estate did not move on a decline" "$(jget "$W/resp.json" admin_id)" "$RES"
expect 201 resident POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$OUTSIDER\",\"reason\":\"second offer, withdrawn\"}" "another handover"
T3=$(jget "$W/resp.json" id)
expect 200 resident POST "/api/finance/estate/$E1/owner-transfer/$T3/decide" '{"accept":false,"note":"withdrawn by the owner"}' "the owner withdraws it"
want "8k a withdrawal is recorded cancelled" "$(jget "$W/resp.json" status)" "cancelled"
expect 200 nobody GET "/api/finance/estate/$E1/owner-transfers" "an estate_admin member sees the estate's whole handover history"
want "8l newest-first, the withdrawn offer is first" "$(jget "$W/resp.json" data.0.id)" "$T3"
want "8m and the accepted handover is still in it" "$(jget "$W/resp.json" data.2.id)" "$T1"
expect 200 admin GET "/api/finance/estate/$E1/owner-transfers" "the demoted former owner is only a party to offers they received"
want "8n no offer is addressed to the former owner" "$(jget "$W/resp.json" data.0.id)" ""

note "--- 9. 0029: suspension and closure stop every estate write"
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"suspend","reason":"estate management under platform review"}' "suspend the estate"
want "9a suspended" "$(jget "$W/resp.json" status)" "suspended"
expect 423 resident PATCH "/api/finance/estate/$E1/info" '{"notice":"while suspended"}' "profile write while suspended"
expect 423 resident POST "/api/finance/estate/$E1/owner-transfer" "{\"to_user_id\":\"$ADMIN\",\"reason\":\"while suspended\"}" "handover while suspended"
expect 423 nobody POST "/api/finance/estate/join/invite" "{\"code\":\"$RES_CODE\"}" "a new member cannot join a suspended estate"
expect 200 admin GET "/api/finance/estate-admin/estates/$E1" "a suspended estate stays readable by the reviewer (read-only posture)"
want "9c suspended estate reports the reason" "$(jget "$W/resp.json" status_reason)" "estate management under platform review"
expect 409 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"verify","reason":"verify is not reachable from suspended"}' "verify from suspended"
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"reactivate","reason":"review cleared"}' "reactivate"
want "9b reactivated" "$(jget "$W/resp.json" status)" "active"
expect 200 resident PATCH "/api/finance/estate/$E1/info" '{"notice":"Management restored."}' "writes work again once reactivated"

note "--- 10. teardown: no probe estate is left live in the shared local database"
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"close","reason":"lane teardown — probe estate retired"}' "close the estate"
expect 200 admin POST "/api/finance/estate-admin/estates/$E3/lifecycle" '{"action":"close","reason":"lane teardown"}' "close the re-application estate"
expect 409 admin POST "/api/finance/estate-admin/estates/$E2/lifecycle" '{"action":"close","reason":"lane teardown"}' "a rejected estate is already closed"

note ""
note "=== result: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ] || exit 1
