#!/usr/bin/env bash
# API_LIVE probe — unit occupancy registry, capacity and overlap, term gating, the two dues
# exemptions, occupancy-proof review, archive gates and the cross-estate authorisation defects
# (Phase 2.4, estate-a M03: EST-UAT-0038, 0043, 0044, 0045, 0046, 0047, 0048, 0051, 0052).
#
# Drives the Go backend on :8095 (see 08-run-server-occupancy.sh). FEATURE_ESTATE_LIFECYCLE_ENABLED +
# FEATURE_ESTATE_VERIFICATION_REQUIRED are on so the estates this lane creates can be published and
# closed over HTTP; the reviewer grant is 02-grant-reviewer.sql. Every estate is closed in section 16.
#
# Run from anywhere:  bash docs/qa/estate-uat-443/live-2026-10-27/09-probe-occupancy.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8095}"
W=/tmp/estate-uat-live
T="$W/tokens"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$DIR/probe-occupancy.out}"
: > "$OUT"

PASS=0; FAIL=0
jwt() { cat "$T/$1.jwt"; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }

jget() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(v==null?"":v)' "$1" "$2"; }
# jpick <file> <array.path> <matchKey> <matchVal> <outKey> — one field of the row that matches, so an
# assertion never depends on which order a list endpoint happened to return.
jpick() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}let v=j;for(const k of process.argv[2].split(".")){if(v==null)break;v=v[k]}const row=(Array.isArray(v)?v:[]).find(r=>String(r[process.argv[3]])===process.argv[4]);const o=row?row[process.argv[5]]:undefined;console.log(o==null?"":o)' "$1" "$2" "$3" "$4" "$5"; }

# jforeign <file> <array.path> <key> <val> — how many rows belong to somebody else. A scoped read is
# proved by what it leaves out, not only by its status code.
jforeign() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log(-1);process.exit(0)}let v=j;for(const k of process.argv[2].split(".")){if(v==null)break;v=v[k]}const rows=Array.isArray(v)?v:[];console.log(rows.filter(r=>String(r[process.argv[3]])!==process.argv[4]).length)' "$1" "$2" "$3" "$4"; }

# jlen <file> <path.to.array> — how many rows a list endpoint actually returned
jlen() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log(-1);process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(Array.isArray(v)?v.length:0)' "$1" "$2"; }

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

expect() {
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  local msg; msg=$(jget "$W/resp.json" error)
  printf '%-4s want=%s got=%s  [%s as %s] %s\n' \
    "$( [ "$CODE" = "$want" ] && echo PASS || echo FAIL )" "$want" "$CODE" "$desc" "$who" "${msg:+— $msg}" | tee -a "$OUT"
  if [ "$CODE" = "$want" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

want() {
  local ok=PASS; [ "$2" = "$3" ] || ok=FAIL
  printf '%-4s %s — got "%s" want "%s"\n' "$ok" "$1" "$2" "$3" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

wantsub() {
  local ok=PASS; grep -q -- "$2" "$W/resp.json" || ok=FAIL
  printf '%-4s %s — body %s "%s"\n' "$ok" "$1" "$( [ "$ok" = PASS ] && echo contains || echo MISSING )" "$2" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

# seed_stepup <label> — the dues and ban routes sit behind the platform step-up gate (EST-UAT-0385),
# whose only delivery channel on this stack is Brevo email to an address nobody reads. The lane
# therefore records the grant a completed challenge would have written: sha256 of the exact bearer
# token, which is what services.HashToken binds it to. The gate stays enforced — the request is
# refused until this row exists, and passes through the real middleware once it does.
seed_stepup() {
  local label=$1 tok hash
  tok=$(tr -d '\r\n' < "$T/$label.jwt")
  hash=$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1)
  docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO auth_step_up_grants (user_id, access_token_hash, method, ip_address, user_agent, expires_at)
     VALUES ('$(uid "$label")','$hash','email_otp','127.0.0.1','estate-occupancy-lane', now() + interval '20 minutes')" >/dev/null
  note "  seeded a 20-minute step-up grant for $label (token $(printf '%.8s' "$hash")…)"
}

# clear_stepup <label> — the state that same grant reaches when it runs out. A second factor is not a
# permanent key, so the lane proves a gated route is gated twice in one run by expiring the row rather
# than by waiting out its TTL.
clear_stepup() {
  docker exec -i supabase_db_spotlight psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
    "DELETE FROM auth_step_up_grants WHERE user_id='$(uid "$1")'" >/dev/null
  note "  cleared the step-up grants for $1"
}

ADMIN=$(uid admin); RES=$(uid resident); GUARD=$(uid guard); OUTSIDER=$(uid nobody)
STAMP=$(date -u +%Y%m%d%H%M%S)
ADDR_1="4 Adeyemi Close, Ikate, Lekki, Lagos"
ADDR_2="8 Awoluyu Crescent, Ikeja GRA, Lagos"
IN_FROM=$(date -u -d '-3 days' +%Y-%m-%d)
IN_UNTIL=$(date -u -d '+60 days' +%Y-%m-%d)
FUTURE=$(date -u -d '+9 days' +%Y-%m-%d)
DUE=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)

# mkunit <estate> <label> <capacity> <var> — create a unit and capture its id
mkunit() {
  call admin POST "/api/finance/estate/$1/properties" \
    "{\"unit_label\":\"$2\",\"property_type\":\"apartment\",\"floor\":\"1\",\"block\":\"C\",\"capacity\":$3}"
  printf '%-4s want=201 got=%s  [create unit %s capacity=%s in %s]\n' \
    "$( [ "$CODE" = "201" ] && echo PASS || echo FAIL )" "$CODE" "$2" "$3" "$1" | tee -a "$OUT"
  if [ "$CODE" = "201" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  local id; id=$(jget "$W/resp.json" id)
  eval "$4=\"$id\""
}

note "=== estate occupancy API_LIVE probe @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE"
note "admin=$ADMIN resident=$RES guard=$GUARD outsider=$OUTSIDER run-id=$STAMP"

note "--- 1. the estate under test is an application first: no occupancy writes before publish"
expect 201 admin POST "/api/finance/estate" "{\"name\":\"UAT Occupancy Estate 1 $STAMP\",\"address\":\"$ADDR_1\"}" "create estate 1"
E1=$(jget "$W/resp.json" id); [ -n "$E1" ] || { note "ABORT — no estate id"; exit 1; }
want "1a a new estate is pending" "$(jget "$W/resp.json" status)" "pending"
expect 423 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"P-000","property_type":"apartment"}' "a unit cannot be added to an unpublished estate"
wantsub "1b refused with the machine-readable lifecycle code" '"ESTATE_NOT_ACTIVE"'
expect 403 resident GET "/api/finance/estate-admin/estates?status=pending" "the review queue is platform RBAC, not estate membership"
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"verify","reason":"occupancy lane — registration and address checked"}' "publish estate 1"
note "estate 1: $E1"

note "--- 2. members and units"
expect 201 admin POST "/api/finance/estate/$E1/residents" "{\"user_id\":\"$RES\",\"unit\":\"C-101\"}" "add the resident as a member"
expect 201 admin POST "/api/finance/estate/$E1/residents" "{\"user_id\":\"$GUARD\",\"unit\":\"C-102\"}" "add the guard as a member"
expect 403 resident POST "/api/finance/estate/$E1/residents" "{\"user_id\":\"$OUTSIDER\",\"unit\":\"C-103\"}" "a member cannot add members"

U_CAP=""; U_DEED=""; U_TERM=""; U_VAC=""; U_FTERM=""; U_CLM=""; U_ADMIN=""; U_NODEED=""; U_ARCH=""; U_DUP=""
mkunit "$E1" "C-101" 2 U_CAP
mkunit "$E1" "C-104" 3 U_DEED
mkunit "$E1" "C-105" 6 U_TERM
mkunit "$E1" "C-106" 4 U_VAC
mkunit "$E1" "C-107" 6 U_FTERM
mkunit "$E1" "C-108" 3 U_CLM
mkunit "$E1" "C-109" 6 U_ADMIN
mkunit "$E1" "C-110" 2 U_NODEED
mkunit "$E1" "C-111" 1 U_ARCH
mkunit "$E1" "C-112" 2 U_DUP
note "units: cap=$U_CAP deed=$U_DEED term=$U_TERM vac=$U_VAC fterm=$U_FTERM clm=$U_CLM admin=$U_ADMIN nodeed=$U_NODEED arch=$U_ARCH dup=$U_DUP"

note "--- 2b. EST-UAT-0038: unit keys, the capacity default and the vacant birth state"
call admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-900","property_type":"apartment","block":"C"}'
want "2b-1 an omitted capacity takes the module default" "$(jget "$W/resp.json" capacity)" "6"
want "2b-2 a new unit is vacant" "$(jget "$W/resp.json" occupancy_status)" "vacant"
U_900=$(jget "$W/resp.json" id)
expect 409 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-900","property_type":"apartment","block":"C","capacity":2}' "the same block/floor/label twice"
expect 400 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-901","property_type":"apartment","capacity":-1}' "negative capacity refused"
expect 400 admin POST "/api/finance/estate/$E1/properties" '{"property_type":"apartment"}' "a unit with no label"
expect 400 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-902","property_type":"flat"}' "a property type outside the column domain (ESTA-D032)"
wantsub "2b-3 the refusal names the domain" "property_type"
expect 201 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-903","property_type":"apartment  ","block":"C"}' "a padded type is stored trimmed rather than refused"
want "2b-4 what was stored" "$(jget "$W/resp.json" property_type)" "apartment"
expect 400 admin PATCH "/api/finance/estate/$E1/properties/$U_DEED" '{"property_type":"maisonette"}' "the same rule on the update route"
expect 400 admin POST "/api/finance/estate/$E1/properties/not-a-uuid/claim" '{"ownership_doc_url":"https://uat.local/docs/deed-x.pdf"}' "a malformed unit id never reaches the database"

note "--- 3. EST-UAT-0043/0046: one admission writes the registration, the deed column and the flag"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_DUP/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"resident\"}" "admin admits themself as a plain resident"
want "3a the residency role the writer kept" "$(jget "$W/resp.json" role)" "estate_admin"
want "3b the occupancy kind it stored" "$(jget "$W/resp.json" occupancy_type)" "resident"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DUP" "the unit recomputed to occupied"
want "3c occupancy_status" "$(jget "$W/resp.json" occupancy_status)" "occupied"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DUP/occupants" "the register for that unit"
want "3d one live registration" "$(jlen "$W/resp.json" data)" "1"
want "3e in effect with no dates (NULL = unrestricted)" "$(jget "$W/resp.json" data.0.in_effect)" "true"
DUP_ROW=$(jget "$W/resp.json" data.0.id)
expect 200 admin GET "/api/finance/estate/$E1/occupants" "the estate-wide register (admin)"
expect 403 nobody GET "/api/finance/estate/$E1/properties/$U_DUP/occupants" "a non-member cannot read a unit's register"
expect 400 admin GET "/api/finance/estate/$E1/properties/not-a-uuid/occupants" "a malformed unit id is a 400"

note "--- 3f. releasing keeps the history and frees the unit"
expect 200 admin DELETE "/api/finance/estate/$E1/properties/$U_DUP/occupants/$ADMIN?reason=moved%20out" "end the registration"
want "3g the release names the registration row it closed" "$(jget "$W/resp.json" occupant_id)" "$DUP_ROW"
want "3g-2 and the unit it leaves" "$(jget "$W/resp.json" occupancy_status)" "vacant"
expect 404 admin DELETE "/api/finance/estate/$E1/properties/$U_DUP/occupants/$ADMIN?reason=again" "releasing twice is a 404, not a second write"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DUP/occupants" "the live register is empty"
want "3h no live rows" "$(jlen "$W/resp.json" data)" "0"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DUP/occupants?include_ended=true" "the closed registration is still readable"
want "3i ended, and not in effect" "$(jget "$W/resp.json" data.0.in_effect)" "false"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DUP" "the unit recomputed to vacant"
want "3j occupancy_status" "$(jget "$W/resp.json" occupancy_status)" "vacant"

note "--- 4. EST-UAT-0044: capacity is a countable rule, and the refusal changes nothing"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_CAP/occupants" "{\"user_id\":\"$RES\",\"occupancy_type\":\"resident\"}" "occupant 1 of 2"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_CAP/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"resident\"}" "occupant 2 of 2"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_CAP/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"resident\"}" "a third occupant in a capacity-2 unit"
wantsub "4a the refusal names the limit" "at capacity"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_CAP/occupants" "the register is unchanged by the refusal"
want "4b still two live registrations" "$(jlen "$W/resp.json" data)" "2"
expect 400 admin PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{"capacity":1}' "lowering capacity below who already lives there"
expect 200 admin PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{"capacity":3}' "raising it"
want "4c the unit now accepts three" "$(jget "$W/resp.json" capacity)" "3"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_CAP/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"resident\"}" "the third bed is now fillable"
expect 400 admin PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{"capacity":0}' "capacity must be at least 1"
expect 400 admin PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{}' "capacity is required"
expect 403 resident PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{"capacity":9}' "capacity is an admin decision"

note "--- 4d. the overlap half: one current owner, one current tenant"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_DEED/occupants" "{\"user_id\":\"$RES\",\"occupancy_type\":\"homeowner\"}" "first homeowner on the deed unit"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_DEED/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"homeowner\"}" "a second homeowner with no explicit transfer"
wantsub "4e the refusal says the deed is taken" "owner"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DEED" "the admission wrote the party column"
want "4f landlord_id" "$(jget "$W/resp.json" landlord_id)" "$RES"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_DEED/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"homeowner\",\"replace_owner\":true}" "an explicit displacement is allowed"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DEED/occupants" "the displaced owner is released, not deleted"
want "4g one live homeowner" "$(jlen "$W/resp.json" data)" "1"
want "4h it is the new one" "$(jget "$W/resp.json" data.0.user_id)" "$GUARD"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DEED/occupants?include_ended=true" "and the old one is in the history"
want "4i two rows including the closed one" "$(jlen "$W/resp.json" data)" "2"

note "--- 5. the landlord's own privilege is exactly 'admit a tenant into the unit I own'"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$RES\",\"occupancy_type\":\"homeowner\"}" "the resident owns the term unit"
expect 201 resident POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"tenant\"}" "the landlord admits their tenant"
expect 403 resident POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"homeowner\"}" "the landlord cannot admit another owner"
expect 403 guard POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\"}" "a tenant cannot admit anybody"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"tenant\"}" "a second tenant on the same unit"
wantsub "5a the refusal names the tenant slot" "tenant"
expect 403 guard DELETE "/api/finance/estate/$E1/properties/$U_TERM/occupants/$RES?reason=not%20mine" "an occupant cannot end somebody else's registration"
expect 200 guard DELETE "/api/finance/estate/$E1/properties/$U_TERM/occupants/$GUARD?reason=leaving" "an occupant can end their own"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"tenant\"}" "the tenant slot is free again"
expect 403 resident DELETE "/api/finance/estate/$E1/properties/$U_TERM/occupants/$ADMIN?reason=landlord%20is%20not%20admin" "ending another person's registration is an admin decision"

note "--- 5b. caller mistakes on the admitting route are 400s, not 500s"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"squatter\"}" "unknown occupancy kind"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\",\"effective_from\":\"2026-12-01\",\"effective_until\":\"2026-01-01\"}" "move-out before move-in"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"not-a-uuid\",\"occupancy_type\":\"resident\"}" "malformed target user id"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" '{"occupancy_type":"resident"}' "no target at all"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\",\"effective_from\":\"next Tuesday\"}" "a non-ISO date names the field"
wantsub "5b-effective_from" "effective_from"

note "--- 6. EST-UAT-0045: the term gates member actions and the unit itself, not the member's own record"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_FTERM/occupants" \
  "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\",\"effective_from\":\"$FUTURE\",\"note\":\"starts $FUTURE\"}" "registration that starts in the future"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_FTERM/occupants" \
  "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"resident\",\"effective_from\":\"$IN_FROM\",\"effective_until\":\"$IN_UNTIL\"}" "registration in effect today"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_FTERM/occupants" "the register marks which terms run today"
want "6a the future registration is not in effect" "$(jpick "$W/resp.json" data user_id "$OUTSIDER" in_effect)" "false"
want "6b the in-term one is" "$(jpick "$W/resp.json" data user_id "$GUARD" in_effect)" "true"
expect 403 nobody GET "/api/finance/estate/$E1/properties/$U_FTERM" "the out-of-term member cannot open the unit"
wantsub "6c the refusal is the term gate, not membership" "not in effect"
# The register is deliberately outside the term gate (occupancy.go: roleIn, not assertRoles): reading
# your own occupancy history is how a member finds out why the door is shut. What the gate must still
# buy them is nobody else's rows, which is what the two scoped reads below prove.
expect 200 nobody GET "/api/finance/estate/$E1/occupants" "the estate-wide register still opens for the gated member"
want "6c-2 it holds only their own rows" "$(jforeign "$W/resp.json" data user_id "$OUTSIDER")" "0"
expect 200 nobody GET "/api/finance/estate/$E1/properties/$U_FTERM/occupants" "and the unit register, where they can see their own term has not started"
want "6c-3 the out-of-term row is there, marked as such" "$(jpick "$W/resp.json" data user_id "$OUTSIDER" in_effect)" "false"
want "6c-4 and nobody else's term is shown" "$(jforeign "$W/resp.json" data user_id "$OUTSIDER")" "0"
expect 200 admin GET "/api/finance/estate/$E1/occupants" "while the admin who can act on it still reads it"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_FTERM" "an estate admin is exempt from the term gate"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_ADMIN/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\"}" "the same person with a dateless registration"
expect 200 nobody GET "/api/finance/estate/$E1/properties/$U_FTERM" "and the gate opens — any live term covering today admits"

note "--- 6d. the platform step-up gate in front of the dues routes, before anything behind it is tested"
# A grant seeded by an earlier run of this lane can still be inside its TTL, and the gate cannot be
# shown closed from an open one, so the lane starts by ending every leftover grant for these users.
clear_stepup admin
clear_stepup resident
expect 403 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "no second factor has been completed in this session"
wantsub "6d-1 the refusal is the step-up gate, not the estate's rule" "step_up_required"
seed_stepup admin
expect 409 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "with the grant the request reaches the estate's own billing rule"

note "--- 7. EST-UAT-0048: a vacant unit is exempt from dues unless an admin overrides in writing"
expect 409 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "billing a vacant unit"
wantsub "7a the refusal is the vacancy exemption" "vacant"
expect 400 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\",\"vacancy_override\":true}" "an override with no reason is not a decision"
expect 201 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\",\"vacancy_override\":true,\"vacancy_override_reason\":\"levy that funds the vacant unit's security\"}" "a reasoned override bills it"
want "7b the invoice carries the override" "$(jget "$W/resp.json" vacancy_override)" "true"
want "7c and the reason it was billed on" "$(jget "$W/resp.json" vacancy_override_reason)" "levy that funds the vacant unit's security"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_VAC/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"tenant\"}" "the unit gets an occupant"
expect 201 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$GUARD\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "and bills normally, with no override"
expect 409 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$GUARD\",\"property_id\":\"$U_900\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "a different vacant unit is still exempt"
seed_stepup resident
expect 403 resident POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "raising dues is an admin action, even for a member who has stepped up"
wantsub "7d the refusal is the estate role, not the gate" "insufficient role"
expect 400 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":0,\"due_date\":\"$DUE\",\"vacancy_override\":true,\"vacancy_override_reason\":\"zero-amount probe\"}" "a zero amount is the caller's arithmetic, not a server failure (ESTA-D036)"
expect 400 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_VAC\",\"category\":\"service_charge\",\"amount_kobo\":-50000,\"due_date\":\"$DUE\",\"vacancy_override\":true,\"vacancy_override_reason\":\"negative-amount probe\"}" "a negative amount is refused at the edge, with the field named, before any billing rule runs (ESTA-D036)"
wantsub "7e the amount refusal names the field the caller got wrong" "amount_kobo"

note "--- 8. EST-UAT-0045 (dues half): a member is not charged outside their term"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_NODEED/occupants" \
  "{\"user_id\":\"$RES\",\"occupancy_type\":\"resident\"}" "a dateless co-resident occupies the unit first"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_NODEED" "so the unit is no longer vacant"
want "8a occupancy_status" "$(jget "$W/resp.json" occupancy_status)" "occupied"
expect 201 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$RES\",\"property_id\":\"$U_NODEED\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "a registration with no dates is billed normally (NULL = unrestricted)"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_NODEED/occupants" \
  "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"tenant\",\"effective_from\":\"$FUTURE\"}" "and a tenant whose term starts later"
expect 409 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$OUTSIDER\",\"property_id\":\"$U_NODEED\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\"}" "billing the out-of-term occupant is refused"
wantsub "8b the refusal is the term exemption" "term on the unit is not running"
expect 400 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$OUTSIDER\",\"property_id\":\"$U_NODEED\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\",\"term_override\":true}" "term override without a reason"
expect 201 admin POST "/api/finance/estate/$E1/dues/invoices" \
  "{\"resident_id\":\"$OUTSIDER\",\"property_id\":\"$U_NODEED\",\"category\":\"service_charge\",\"amount_kobo\":50000,\"due_date\":\"$DUE\",\"term_override\":true,\"term_override_reason\":\"arrears agreed under the signed lease\"}" "a reasoned term override bills"
want "8c the invoice records the term override" "$(jget "$W/resp.json" term_override)" "true"

note "--- 9. the occupancy decisions and the exemptions are audited, not silent"
expect 200 admin GET "/api/finance/estate/$E1/admin/audit-log?limit=200" "the estate audit log"
wantsub "9a the admission is audited" "ESTATE_UNIT_OCCUPANT_ADMITTED"
wantsub "9b the release is audited" "ESTATE_UNIT_OCCUPANT_RELEASED"
wantsub "9c the vacancy override is audited" "INVOICE_VACANCY_OVERRIDE"
wantsub "9d the term override is audited" "INVOICE_TERM_OVERRIDE"
expect 403 guard GET "/api/finance/estate/$E1/admin/audit-log" "the log is admin-only"

note "--- 10. EST-UAT-0051: proof of occupancy is declared, queued, reviewed and attributed"
expect 200 resident PUT "/api/finance/estate/$E1/profile" \
  '{"occupancy_type":"homeowner","ownership_doc_url":"https://uat.local/docs/deed-C108.pdf","phone":"+2348000000001"}' "the resident declares a deed"
expect 200 resident GET "/api/finance/estate/$E1/profile/occupancy-proof" "they can read the state of their own claim"
want "10a the declaration is unverified until an admin looks" "$(jget "$W/resp.json" proof_status)" "unverified"
want "10b the label they declared" "$(jget "$W/resp.json" occupancy_type)" "homeowner"
expect 201 resident POST "/api/finance/estate/$E1/properties/$U_CLM/claim" '{"ownership_doc_url":"https://uat.local/docs/deed-C108.pdf"}' "file an ownership claim on a unit"
CL1=$(jget "$W/resp.json" id)
expect 201 resident POST "/api/finance/estate/$E1/properties/$U_CLM/claim" '{"ownership_doc_url":"https://uat.local/docs/deed-C108-v2.pdf"}' "re-filing the same claim re-opens it rather than queueing twice"
want "10c the re-filed claim is pending again" "$(jget "$W/resp.json" status)" "pending"
CL2=$(jget "$W/resp.json" id)
expect 403 guard GET "/api/finance/estate/$E1/ownership-claims" "the queue is admin-only"
expect 200 admin GET "/api/finance/estate/$E1/ownership-claims?status=pending" "the admin reads the queue"
want "10d the claim id is stable across the re-file" "$CL2" "$CL1"
wantsub "10e the queued claim is the one filed" "$CL1"
expect 400 admin GET "/api/finance/estate/$E1/ownership-claims?status=bogus" "an unknown status filter is a 400"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_CLM/claims/$CL1/review" '{"decision":"mmaybe"}' "an unknown decision is a 400"
expect 403 guard POST "/api/finance/estate/$E1/properties/$U_CLM/claims/$CL1/review" '{"decision":"approved"}' "a member cannot review a claim"
expect 200 admin POST "/api/finance/estate/$E1/properties/$U_CLM/claims/$CL1/review" '{"decision":"approved","note":"deed matched the registry"}' "approve the claim"
want "10f the claim is approved" "$(jget "$W/resp.json" status)" "approved"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_CLM" "the approval put the claimer on the deed"
want "10g landlord_id" "$(jget "$W/resp.json" landlord_id)" "$RES"
expect 200 admin GET "/api/finance/estate/$E1/profile/occupancy-proof?user_id=$RES" "and made the declaration a checked document"
want "10h proof_status" "$(jget "$W/resp.json" proof_status)" "verified"
want "10i with a reviewer identity" "$(jget "$W/resp.json" proof_verified_by)" "$ADMIN"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_CLM/claims/$CL1/review" '{"decision":"approved"}' "re-reviewing a decided claim"
expect 404 admin POST "/api/finance/estate/$E1/properties/$U_CLM/claims/00000000-0000-4000-8000-000000000000/review" '{"decision":"approved"}' "a claim id from nowhere"
expect 200 guard GET "/api/finance/estate/$E1/profile/occupancy-proof?user_id=$RES" "the admin parameter is ignored for a member, not obeyed"
want "10x a member asking for somebody else's file gets their own" "$(jget "$W/resp.json" user_id)" "$GUARD"

note "--- 10j. an approval cannot seize a unit somebody else is recorded as owning"
expect 201 resident POST "/api/finance/estate/$E1/properties/$U_DEED/claim" '{"ownership_doc_url":"https://uat.local/docs/deed-C104.pdf"}' "the resident claims the unit the guard owns"
CL3=$(jget "$W/resp.json" id)
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_DEED/claims/$CL3/review" '{"decision":"approved","note":"trying to move the guard off the deed"}' "approving it is refused — the overlap rule still applies"
wantsub "10k the refusal names the owner already on the deed" "already recorded as this unit"
expect 200 admin GET "/api/finance/estate/$E1/ownership-claims?status=pending" "the refused review rolled back: the claim is still pending, not approved"
wantsub "10l the claim is in the pending queue" "$CL3"
expect 200 admin POST "/api/finance/estate/$E1/properties/$U_DEED/claims/$CL3/review" '{"decision":"rejected","reject_reason":"the deed on file names another owner"}' "so it can be rejected honestly"
want "10m rejected with a reason" "$(jget "$W/resp.json" status)" "rejected"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_DEED" "and the deed did not move"
want "10n landlord_id unchanged" "$(jget "$W/resp.json" landlord_id)" "$GUARD"

note "--- 10o. replacing a document resets the verdict; approving an empty declaration is refused"
expect 200 resident PUT "/api/finance/estate/$E1/profile" \
  '{"occupancy_type":"homeowner","ownership_doc_url":"https://uat.local/docs/deed-C108-v3.pdf","phone":"+2348000000001"}' "re-declare with a different file"
expect 200 resident GET "/api/finance/estate/$E1/profile/occupancy-proof" "the old approval did not travel with the new file"
want "10p proof_status back to unverified" "$(jget "$W/resp.json" proof_status)" "unverified"
want "10q and no reviewer attached" "$(jget "$W/resp.json" proof_verified_by)" ""
expect 403 resident POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" "{\"user_id\":\"$RES\",\"decision\":\"verified\"}" "a member cannot mark their own documents verified"
expect 400 admin POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" "{\"user_id\":\"$RES\",\"decision\":\"maybe\"}" "an unknown decision is a 400"
expect 200 admin POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" "{\"user_id\":\"$RES\",\"decision\":\"rejected\",\"note\":\"the file is a mortgage statement, not a deed\"}" "reject with a reason"
want "10r the rejection is recorded" "$(jget "$W/resp.json" proof_status)" "rejected"
want "10s and the resident can read why" "$(jget "$W/resp.json" proof_review_note)" "the file is a mortgage statement, not a deed"
expect 200 admin POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" "{\"user_id\":\"$RES\",\"decision\":\"verified\",\"note\":\"the third file checked against the registry\"}" "then verified once the real deed is filed"
want "10t verified by the admin" "$(jget "$W/resp.json" proof_status):$(jget "$W/resp.json" proof_verified_by)" "verified:$ADMIN"
# Two different "nothing to review" states, and the queue has to tell them apart: this estate holds no
# registration for the id at all (404 — the reviewer's query is wrong), versus a member whose file has
# no document behind the label (409 — there is a queue entry, and it is not approvable, ESTA-D035).
expect 404 admin POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" '{"user_id":"11111111-1111-4111-8111-111111111111","decision":"verified","note":"nobody on the register"}' "an id with no registration in this estate is a 404"
expect 200 guard PUT "/api/finance/estate/$E1/profile" '{"occupancy_type":"tenant","phone":"+2348000000002"}' "the guard declares a label and files no document"
expect 409 admin POST "/api/finance/estate/$E1/profile/occupancy-proof/verify" "{\"user_id\":\"$GUARD\",\"decision\":\"verified\",\"note\":\"approving what was never filed\"}" "approving an empty declaration is refused (ESTA-D035)"
wantsub "10u the refusal names the missing document" "no document on record"

note "--- 11. EST-UAT-0047: a tenancy approval admits the tenant, attributes the reviewer, and demotes nobody"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_ADMIN/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"homeowner\"}" "the guard owns the second unit"
expect 201 resident POST "/api/finance/estate/$E1/properties/$U_ADMIN/tenancy" \
  "{\"landlord_id\":\"$ADMIN\",\"lease_start\":\"$IN_FROM\",\"lease_end\":\"$IN_UNTIL\",\"agreement_url\":\"https://uat.local/docs/lease-nomatch.pdf\"}" "the body's landlord_id is not trusted — the unit's real owner is used"
TRX=$(jget "$W/resp.json" id)
want "11a the request is addressed to the deed owner, whoever the body named" "$(jget "$W/resp.json" landlord_id)" "$GUARD"
expect 404 admin POST "/api/finance/estate/$E1/properties/$U_ADMIN/tenancy/$TRX/review" '{"decision":"approved"}' "the estate admin the body named cannot approve it either"
expect 400 resident POST "/api/finance/estate/$E1/properties/$U_ADMIN/tenancy/$TRX/review" '{"decision":"mmaybe"}' "an unknown decision is a 400"

expect 201 admin POST "/api/finance/estate/$E1/properties/$U_CLM/tenancy" \
  "{\"landlord_id\":\"$RES\",\"lease_start\":\"$IN_FROM\",\"lease_end\":\"$IN_UNTIL\",\"agreement_url\":\"https://uat.local/docs/lease-admin.pdf\"}" "the estate admin rents the unit the resident owns"
TRY=$(jget "$W/resp.json" id)
expect 404 guard POST "/api/finance/estate/$E1/properties/$U_CLM/tenancy/$TRY/review" '{"decision":"approved"}' "a plain member cannot approve somebody else's request"
expect 404 admin POST "/api/finance/estate/$E1/properties/$U_CLM/tenancy/$TRY/review" '{"decision":"approved"}' "not even the tenant, when the tenant is an estate admin"
expect 404 resident POST "/api/finance/estate/$E1/properties/$U_DEED/tenancy/$TRY/review" '{"decision":"approved"}' "and approving under the wrong unit path changes nothing"
expect 200 resident POST "/api/finance/estate/$E1/properties/$U_CLM/tenancy/$TRY/review" '{"decision":"approved","note":"lease signed, deposit cleared"}' "its landlord approves"
want "11a the request is approved" "$(jget "$W/resp.json" status)" "approved"
want "11b with the reviewer recorded" "$(jget "$W/resp.json" reviewed_by)" "$RES"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_CLM/occupants" "the approval wrote a registration over the lease window"
want "11c the admin is on the register as tenant" "$(jpick "$W/resp.json" data user_id "$ADMIN" occupancy_type)" "tenant"
want "11d and in effect" "$(jpick "$W/resp.json" data user_id "$ADMIN" in_effect)" "true"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_CLM" "the unit's tenant column came from the same decision"
want "11e tenant_id" "$(jget "$W/resp.json" tenant_id)" "$ADMIN"
expect 200 admin GET "/api/finance/estate/$E1/profile/occupancy-proof?user_id=$ADMIN" "the approved agreement is a checked document"
want "11f proof_status" "$(jget "$W/resp.json" proof_status)" "verified"
expect 404 resident POST "/api/finance/estate/$E1/properties/$U_CLM/tenancy/$TRY/review" '{"decision":"rejected","reject_reason":"too late"}' "a decided request cannot be re-decided"
expect 200 admin GET "/api/finance/estate/$E1/admin/residents?role=estate_admin" "the admin who moved in as a tenant is still an estate admin"
wantsub "11g the demotion defect is gone — the admin is in the admin list" "$ADMIN"
expect 200 admin PATCH "/api/finance/estate/$E1/properties/$U_CAP/capacity" '{"capacity":4}' "and still administers the units"
expect 200 admin GET "/api/finance/estate/$E1/ownership-claims" "and still reads the review queues"

note "--- 11i. a unit with nobody on the deed has no landlord to approve"
expect 409 guard POST "/api/finance/estate/$E1/properties/$U_DUP/tenancy" \
  "{\"landlord_id\":\"$RES\",\"lease_start\":\"$IN_FROM\",\"lease_end\":\"$IN_UNTIL\",\"agreement_url\":\"https://uat.local/docs/lease-nobody.pdf\"}" "the request is refused at filing, not queued for nobody to decide"
wantsub "11j the refusal names the missing landlord" "landlord"

note "--- 12. EST-UAT-0052: the register outranks the flag, and an occupied unit cannot be retired"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupancy" '{"status":"vacant"}' "cannot flag a populated unit vacant"
wantsub "12a the refusal names the register" "occupants"
expect 400 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupancy" '{"status":"moved-in"}' "an invented status is a 400, not a 500"
expect 403 resident POST "/api/finance/estate/$E1/properties/$U_TERM/occupancy" '{"status":"reserved"}' "a member cannot set the flag"
expect 200 admin POST "/api/finance/estate/$E1/properties/$U_DUP/occupancy" '{"status":"reserved"}' "an empty unit can be reserved"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_TERM/archive" "a populated unit cannot be archived"
expect 200 admin POST "/api/finance/estate/$E1/properties/$U_ARCH/archive" "an empty unit archives"
expect 404 admin POST "/api/finance/estate/$E1/properties/$U_ARCH/occupants" "{\"user_id\":\"$GUARD\",\"occupancy_type\":\"resident\"}" "and takes no further admissions"
expect 404 guard POST "/api/finance/estate/$E1/properties/$U_ARCH/claim" '{"ownership_doc_url":"https://uat.local/docs/x.pdf"}' "or claims"
expect 201 admin POST "/api/finance/estate/$E1/properties" '{"unit_label":"C-111","property_type":"apartment","block":"C","floor":"1","capacity":1}' "and a retired unit's label can be reused by a live one"
expect 200 guard DELETE "/api/finance/estate/$E1/properties/$U_VAC/occupants/$GUARD?reason=the%20invoice%20outlives%20the%20occupant" "the occupant leaves; the receivable does not"
expect 409 admin POST "/api/finance/estate/$E1/properties/$U_VAC/archive" "a unit with an open invoice cannot be retired"
wantsub "12b the refusal names the receivable" "invoices"
expect 200 admin GET "/api/finance/estate/$E1/properties/$U_TERM/analytics" "analytics still reads for a live unit"

note "--- 13. a banned membership is not revived by an admission"
# The grant seeded in 6d is still inside its TTL, so the lane ends it first — the same state a real
# session reaches when the second factor runs out — and shows the ban route refusing again on the way.
clear_stepup admin
expect 403 admin POST "/api/finance/estate/$E1/admin/residents/$OUTSIDER/ban" '{"reason":"probe"}' "the ban route stands behind the same step-up gate"
wantsub "13d the refusal is the gate" "step_up_required"
seed_stepup admin
expect 200 admin POST "/api/finance/estate/$E1/admin/residents/$OUTSIDER/ban" '{"reason":"lane check — banned membership cannot be admitted"}' "ban the outsider"
expect 403 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\"}" "admitting them is refused"
wantsub "13a the refusal is the membership, not the unit" "membership"
expect 200 admin POST "/api/finance/estate/$E1/admin/residents/$OUTSIDER/restore" '{"reason":"lane check — restored"}' "restore for the teardown"
expect 201 admin POST "/api/finance/estate/$E1/properties/$U_TERM/occupants" "{\"user_id\":\"$OUTSIDER\",\"occupancy_type\":\"resident\"}" "and the admission works again"

note "--- 14. cross-estate authorisation: another estate's id is not a capability"
expect 201 resident POST "/api/finance/estate" "{\"name\":\"UAT Occupancy Estate 2 $STAMP\",\"address\":\"$ADDR_2\"}" "the resident founds a second estate"
E2=$(jget "$W/resp.json" id)
expect 200 admin POST "/api/finance/estate-admin/estates/$E2/lifecycle" '{"action":"verify","reason":"occupancy lane — second estate for the cross-estate checks"}' "the platform publishes it"
expect 403 admin GET "/api/finance/estate/$E2/properties" "the estate-1 admin is not a member of estate 2"
call resident POST "/api/finance/estate/$E2/properties" '{"unit_label":"X-001","property_type":"apartment","block":"X","capacity":2}'
U2=$(jget "$W/resp.json" id)
expect 404 admin POST "/api/finance/estate/$E1/properties/$U2/occupants" "{\"user_id\":\"$ADMIN\",\"occupancy_type\":\"resident\"}" "admitting into another estate's unit through this estate's path"
expect 404 resident POST "/api/finance/estate/$E1/properties/$U2/claim" '{"ownership_doc_url":"https://uat.local/docs/deed-X001.pdf"}' "and claiming another estate's unit"
expect 201 resident POST "/api/finance/estate/$E2/profile/vehicles" '{"plate":"LAG-999-ZZ","make":"Honda","model":"Civic","color":"black","doc_url":"https://uat.local/docs/ego-X001.pdf"}' "the resident registers a car in their own estate"
V2=$(jget "$W/resp.json" id)
expect 404 admin POST "/api/finance/estate/$E1/profile/vehicles/$V2/verify" '{}' "another estate's admin cannot verify it through this estate"
expect 200 resident POST "/api/finance/estate/$E2/profile/vehicles/$V2/verify" '{}' "its own estate's admin can"
expect 403 admin GET "/api/finance/estate/$E2/properties/$U2" "and the estate-1 admin cannot even read estate 2's unit"
expect 409 nobody POST "/api/finance/estate/$E2/properties/$U2/tenancy" \
  "{\"landlord_id\":\"$RES\",\"lease_start\":\"$IN_FROM\",\"lease_end\":\"$IN_UNTIL\",\"agreement_url\":\"https://uat.local/docs/lease-stranger.pdf\"}" "a unit nobody owns has no landlord to answer, whoever files"
expect 201 resident POST "/api/finance/estate/$E2/properties/$U2/occupants" "{\"user_id\":\"$RES\",\"occupancy_type\":\"homeowner\"}" "estate 2's owner is recorded on that unit"
expect 201 nobody POST "/api/finance/estate/$E2/properties/$U2/tenancy" \
  "{\"landlord_id\":\"$ADMIN\",\"lease_start\":\"$IN_FROM\",\"lease_end\":\"$IN_UNTIL\",\"agreement_url\":\"https://uat.local/docs/lease-stranger.pdf\"}" "filing an application needs no membership — that is how a prospective tenant arrives"
wantsub "14a the request is addressed to the unit's real landlord, whoever the body named" "$RES"
wantsub "14b and the response discloses that landlord id to a filer with no membership (ESTA-D039)" "$RES"
expect 403 nobody GET "/api/finance/estate/$E2/properties" "filing one grants the applicant no access to the estate"

note "--- 14b. a vehicle verdict does not survive the document it was based on"
expect 201 admin POST "/api/finance/estate/$E1/profile/vehicles" '{"plate":"LAG-123-XY","make":"Toyota","model":"Corolla","color":"grey","doc_url":"https://uat.local/docs/ego-C101.pdf"}' "the admin registers a car in estate 1"
V1=$(jget "$W/resp.json" id)
expect 200 admin POST "/api/finance/estate/$E1/profile/vehicles/$V1/verify" '{}' "and verifies it"
expect 200 admin GET "/api/finance/estate/$E1/profile/vehicles" "the owner reads the verdict"
want "14b-1 verified" "$(jget "$W/resp.json" data.0.verified)" "true"
expect 201 admin POST "/api/finance/estate/$E1/profile/vehicles" '{"plate":"LAG-123-XY","make":"Toyota","model":"Corolla","color":"blue","doc_url":"https://uat.local/docs/ego-C101-v2.pdf"}' "re-registering the plate with a different document"
want "14b-2 revokes the old verdict" "$(jget "$W/resp.json" verified)" "false"

note "--- 15. the resident card carries the proof state a guard reads"
expect 200 resident GET "/api/finance/estate/$E1/profile/id-card" "the card of the verified homeowner"
want "15a the label" "$(jget "$W/resp.json" occupancy_type)" "homeowner"
want "15b and that the estate checked it" "$(jget "$W/resp.json" proof_status)" "verified"

note "--- 16. teardown: end every registration, then close both estates"
for u in $U_CAP $U_DEED $U_TERM $U_VAC $U_FTERM $U_CLM $U_ADMIN $U_NODEED $U_DUP $U_900; do
  for who in $RES $GUARD $ADMIN $OUTSIDER; do
    call admin DELETE "/api/finance/estate/$E1/properties/$u/occupants/$who" ""
    [ "$CODE" = "200" ] && note "  released $who from $u"
  done
done
call resident DELETE "/api/finance/estate/$E2/properties/$U2/occupants/$RES" ""
expect 200 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"close","reason":"lane teardown — occupancy probe estate retired"}' "close estate 1"
expect 200 admin POST "/api/finance/estate-admin/estates/$E2/lifecycle" '{"action":"close","reason":"lane teardown — second estate retired"}' "close estate 2"
expect 403 resident POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"reopen","reason":"the review queue is platform RBAC, not estate ownership"}' "its owner cannot reopen it from outside the queue"
expect 409 admin POST "/api/finance/estate-admin/estates/$E1/lifecycle" '{"action":"close","reason":"already closed"}' "closure is terminal"

note ""
note "=== result: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ] || exit 1
