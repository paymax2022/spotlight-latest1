#!/usr/bin/env bash
# BFF lane (slice 4): the shipped Next.js visitor surface /api/v1/visitor/** over
# HTTP against the seeded UAT Gate Estate Alpha. This is the surface the mobile
# guard app actually calls, so it is the only place a visitor case can be closed.
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
EST=0a1e5701-0000-4000-8000-000000000001
GATE=0a1e5701-0000-4000-8000-000000000101
GATE2=0a1e5701-0000-4000-8000-000000000102
T=/tmp/estate-uat-live/tokens
W=/tmp/estate-uat-live
OUT="$W/probe-bff.out"
: > "$OUT"

PASS=0; FAIL=0
jwt() { cat "$T/$1.jwt"; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }
jget() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(v==null?"":v)' "$1" "$2"; }

call() { # call <label> <METHOD> <path> [body]
  local label=$1 method=$2 path=$3 body=${4:-}
  local hdr=(-H "Authorization: Bearer $(jwt "$label")")
  local extra=()
  [ -n "$body" ] && extra=(-H 'Content-Type: application/json' -d "$body")
  CODE=$(curl -sS -m 60 -o "$W/resp.json" -w '%{http_code}' -X "$method" "$BASE$path" "${hdr[@]}" ${extra+"${extra[@]}"})
}

expect() { # expect <want> <who> <METHOD> <path> [body] <desc>
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  if [ "$CODE" = "000" ]; then
    printf 'ABORT want=%s got=000  [%s as %s] dev server unreachable at %s\n' "$want" "$desc" "$who" "$(date -u +%H:%M:%SZ)" | tee -a "$OUT"
    exit 90
  fi
  local mark=PASS; [ "$CODE" = "$want" ] || mark=FAIL
  [ "$mark" = PASS ] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
  printf '%-4s want=%s got=%s  [%s as %s] %s\n' "$mark" "$want" "$CODE" "$desc" "$who" "$(head -c 200 "$W/resp.json")" | tee -a "$OUT"
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

GUARD=$(uid guard); RES=$(uid resident); NB=$(uid nobody)
VF=$(date -u +%Y-%m-%dT%H:%M:%SZ); VU=$(date -u -d '+3 hours' +%Y-%m-%dT%H:%M:%SZ)

note "=== estate-a BFF lane @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE estate=$EST"

note "--- A. guard shift lifecycle (POST gate/session is what unlocks every guard route)"
expect 404 guard GET "/api/v1/visitor/gate/session" "no shift started yet"
expect 201 guard POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$GATE\"}" "open shift at Main Gate"
SESSION_ID=$(jget "$W/resp.json" id); note "gate session id=$SESSION_ID"
expect 200 guard GET "/api/v1/visitor/gate/session" "read back the open shift"
expect 403 nobody POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$GATE\"}" "non-member cannot open a shift"
expect 404 guard POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$(uuidgen 2>/dev/null || echo 7f7f7f7f-7f7f-7f7f-7f7f-7f7f7f7f7f7f)\"}" "shift at an unknown gate"

note "--- B. resident issues a visitor pass (host side)"
expect 201 resident POST "/api/v1/visitor/codes" \
  "{\"visitorName\":\"BFF Golden Guest\",\"visitorPhone\":\"08031234567\",\"vehiclePlate\":\"LAG-123XA\",\"purpose\":\"Estate UAT lane\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":2,\"usageMode\":\"entry_exit\",\"partySize\":2}" \
  "host issues a 2-entry entry/exit pass"
CODE1=$(jget "$W/resp.json" id); NUM1=$(jget "$W/resp.json" codeValue)
note "pass id=$CODE1 numeric=$NUM1"
expect 400 resident POST "/api/v1/visitor/codes" "{\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\"}" "pass without a visitor name refused"
expect 400 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Past Window\",\"validityStart\":\"2020-01-01T00:00:00Z\",\"validityEnd\":\"2020-01-02T00:00:00Z\"}" "pass for an ended window refused"
expect 200 resident GET "/api/v1/visitor/codes" "host lists own passes"

note "--- C. gate lookup, manual entry, admit, open visits, checkout"
expect 200 guard GET "/api/v1/visitor/gate/lookup?code=$NUM1" "guard types the 6-digit code (manual entry)"
expect 200 guard GET "/api/v1/visitor/gate/lookup?code=${CODE1:0:8}" "guard types an id prefix"
expect 200 guard GET "/api/v1/visitor/gate/lookup?code=000000" "unknown code answers found=false, not an error"
expect 200 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE1\",\"visitorName\":\"BFF Golden Guest\",\"unitLabel\":\"A-102\",\"plate\":\"LAG-123XA\"}" "guard admits the visitor"
VISIT=$(jget "$W/resp.json" id); note "visit event id=$VISIT"
expect 201 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Single Use Guest\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":1}" "host issues a 1-entry pass"
CODE1B=$(jget "$W/resp.json" id)
expect 200 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE1B\"}" "single-use pass admits once"
expect 409 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE1B\"}" "second admit of the spent pass refused 409"
expect 200 guard GET "/api/v1/visitor/gate/open-visits" "open visits list"
expect 200 guard POST "/api/v1/visitor/gate/checkout" "{\"visitEventId\":\"$VISIT\"}" "guard checks the visitor out"
expect 200 guard GET "/api/v1/visitor/gate/log" "gate log holds the events"
note "gate log head: $(head -c 300 "$W/resp.json")"

note "--- D. denial, walk-in, emergency mode, incidents"
expect 201 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Denied Guest\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":1}" "host issues a pass to be denied"
CODE2=$(jget "$W/resp.json" id)
expect 200 guard POST "/api/v1/visitor/gate/deny" "{\"accessCodeId\":\"$CODE2\",\"visitorName\":\"Denied Guest\",\"reason\":\"No matching resident at the gate\"}" "guard denies entry"
expect 200 guard POST "/api/v1/visitor/gate/walkin" "{\"visitorName\":\"Walk-in Contractor\",\"unitLabel\":\"A-101\",\"action\":\"walk_in\",\"reason\":\"Unannounced delivery\"}" "walk-in admission"
expect 200 guard POST "/api/v1/visitor/gate/walkin" "{\"visitorName\":\"Emergency Entry\",\"unitLabel\":\"A-101\",\"action\":\"emergency\",\"reason\":\"Ambulance through Main Gate\"}" "emergency gate mode"
expect 201 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Tailgate Guest\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":1}" "host issues a pass for the tailgating case"
CODE3=$(jget "$W/resp.json" id); NUM3=$(jget "$W/resp.json" codeValue)
BEFORE_USED=$(jget "$W/resp.json" entriesUsed)
expect 201 guard POST "/api/v1/visitor/incidents" "{\"kind\":\"incident\",\"severity\":\"high\",\"title\":\"Tailgating: two cars through one gate cycle\",\"description\":\"Second vehicle followed the admitted car through Main Gate\",\"gateId\":\"$GATE\",\"escalate\":true}" "tailgating incident raised"
expect 200 guard GET "/api/v1/visitor/gate/lookup?code=$NUM3" "incident did NOT consume the pass (still lookupable)"
note "pass 3 entriesUsed before incident: $BEFORE_USED / after: $(jget "$W/resp.json" code.entriesUsed)  status=$(jget "$W/resp.json" code.status)"

note "--- E. plate scan, watchlist"
expect 200 guard POST "/api/v1/visitor/gate/vehicles/scan" '{"plate":"LAG-123XA"}' "plate scan matches the issued pass"
expect 400 guard POST "/api/v1/visitor/gate/vehicles/scan" '{"plate":""}' "blank plate refused"
expect 201 guard POST "/api/v1/visitor/blacklist" "{\"matchKind\":\"phone\",\"matchValue\":\"08091112222\",\"name\":\"Watch Listed Driver\",\"reason\":\"Prior theft at service gate\"}" "estate adds a watchlist entry"
expect 201 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Watchlist Guest\",\"visitorPhone\":\"08091112222\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":1}" "host issues a pass to a watchlisted phone (flagged, not refused)"
CODE4=$(jget "$W/resp.json" id); note "watchlisted pass id=$CODE4 blacklisted=$(jget "$W/resp.json" visitor.isBlacklisted)"
expect 403 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE4\"}" "gate denies the watchlisted pass"

note "--- F. bulk for an event + CSV import"
expect 201 resident POST "/api/v1/visitor/codes/event" "{\"eventName\":\"Estate UAT Open Day\",\"guestCount\":12,\"validFrom\":\"$VF\",\"validUntil\":\"$VU\",\"estateId\":\"$EST\"}" "bulk event codes"
note "event response: $(head -c 260 "$W/resp.json")"
printf 'visitor_name,code_type,valid_from,valid_until,unit_label\nCSV Guest One,one_time,%s,%s,A-102\nCSV Guest Two,one_time,%s,%s,A-102\nBAD ROW\n' "$VF" "$VU" "$VF" "$VU" > "$W/import.csv"
IMPORT_CODE=$(curl -sS -m 60 -o "$W/resp.json" -w '%{http_code}' -X POST "$BASE/api/v1/visitor/codes/import" \
  -H "Authorization: Bearer $(jwt resident)" -F "file=@$W/import.csv")
note "csv import -> HTTP $IMPORT_CODE $(head -c 200 "$W/resp.json")"

note "--- G. offline sync (flagged events replayed by UUID)"
EVT_ID=$(node -e 'console.log(require("crypto").randomUUID())')
expect 200 guard POST "/api/v1/visitor/gate/sync" "{\"events\":[{\"id\":\"$EVT_ID\",\"action\":\"check_in\",\"visitorName\":\"Offline Admit\",\"accessCodeId\":\"$CODE3\",\"capturedAt\":\"$VF\"}]}" "offline event uploaded"
expect 200 guard POST "/api/v1/visitor/gate/sync" "{\"events\":[{\"id\":\"$EVT_ID\",\"action\":\"check_in\",\"visitorName\":\"Offline Admit\",\"accessCodeId\":\"$CODE3\"}]}" "same UUID replayed (dedup)"
expect 400 guard POST "/api/v1/visitor/gate/sync" '{"events":[{"action":"check_in","visitorName":"No Id"}]}' "event without a UUID refused"
expect 200 guard GET "/api/v1/visitor/gate/pending-sync-count" "pending sync count"

note "--- H. handover closes the shift and the guard surface goes dark"
expect 200 guard POST "/api/v1/visitor/gate/handover" "{\"notes\":\"Handed Main Gate to night shift, 1 open visit\"}" "guard records handover"
expect 403 guard GET "/api/v1/visitor/gate/expected" "no shift -> guard endpoints 403"
expect 403 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE1\"}" "no shift -> admit refused"
expect 201 guard POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$GATE2\"}" "next guard signs in at the Service Gate"

note "--- I. the BFF has no guard-role authorisation (ESTA-D021 stays open)"
expect 201 resident POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$GATE\"}" "PLAIN RESIDENT (no gate_officer grant) opens a gate session"
expect 200 resident GET "/api/v1/visitor/gate/expected" "plain resident reads the expected-visitors list"
expect 200 resident POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE1\"}" "plain resident admits a visitor"
expect 403 nobody GET "/api/v1/visitor/gate/expected" "non-member still refused"

note "--- J. require_host_approval is not enforced at the BFF (ESTA-D022 / EST-UAT-0088)"
expect 201 resident POST "/api/v1/visitor/codes" "{\"visitorName\":\"Needs Approval\",\"codeType\":\"one_time\",\"validityStart\":\"$VF\",\"validityEnd\":\"$VU\",\"maxEntries\":1,\"requireHostApproval\":true}" "host asks for an approval-gated pass"
CODE5=$(jget "$W/resp.json" id)
DBFLAG=$(docker exec supabase_db_spotlight psql -U postgres -d postgres -Atc "select require_host_approval from visitor_access_codes where id='$CODE5'")
note "require_host_approval stored in DB for that pass: $DBFLAG (BFF insert never writes the column)"
expect 201 guard POST "/api/v1/visitor/gate/session" "{\"estateId\":\"$EST\",\"gateId\":\"$GATE\"}" "guard reopens a shift"
expect 200 guard POST "/api/v1/visitor/gate/approve" "{\"accessCodeId\":\"$CODE5\"}" "guard admits WITHOUT any host decision — BFF ignores the flag"

note "=== BFF lane summary: PASS=$PASS FAIL=$FAIL"
