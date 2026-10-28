#!/usr/bin/env bash
# API_LIVE probe — the *Next.js BFF* half of the estate inbox archive / search / pin / retention case
# (Phase 2.5a, estate-d M18: EST-UAT-0359, defect ESTD-D008 and the BFF half of ESTD-D025).
#
# Why this file exists next to 06-probe-notifications.sh: the product has two estate surfaces, and EST-UAT-0359
# was raised against the mobile app, which talks to this one. 06 drove Go's /api/finance/estate/:id/** on :8095;
# this drives /api/v1/estate/** on the Next dev server 08b-run-web.sh resolves for this checkout — a
# different authorization model (service-role PostgREST; the estate comes from the caller's membership and
# never from the path), a different item shape (camelCase `category`/`deepLink`/`readAt`, the app's pre-existing
# contract), and a different failure ordering. A rule proven on one surface only is half a rule.
#
# Why its own identities: the first real run of this file drove the shared `resident` / `admin` / `nobody`
# tokens and failed ~100 assertions that looked like product defects. They were harness defects. Those three
# identities each hold many memberships (admin 14, resident 11, outsider 5), so `getResidentContext`'s
# `.limit(1)` with no ORDER BY resolved whichever row Postgres returned first — one run landed on 'UAT Gate
# Estate Alpha', whose 3 notification rows explained every "why is the total 3", and a *different* estate
# explained "PUT /retention answered 200 on a pending estate". Every call below goes through inboxres /
# inboxadmin / inboxnone, whose membership counts section 1 asserts are 1 / 1 / 0 before any HTTP assertion
# is made. The web server was then checked rather than blamed: the :3000 next dev process runs from this
# frontend-web directory (its node_modules path is in the process command line, and the dev log shows it
# compiling this lane's routes), so 08b-run-web.sh verifies whichever surface it points BASE at, and this
# file's section 1 preflight fails fast if that surface does not answer the Phase 2.5a contract.
#
# Run from anywhere:  BASE=http://127.0.0.1:3005 bash docs/qa/estate-uat-443/live-2026-10-28/08-probe-notifications-bff.sh
#   after 01-signin.sh, 02-grant-reviewer.sql and 07-seed-notifications-bff.sql at the same stamp.
#   (08b-run-web.sh starts the server and runs this file with the right BASE.)
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3005}"
W=/tmp/estate-uat-live
T="$W/tokens"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$DIR/probe-notifications-bff-phase2.5a.out}"
STAMP="${STAMP:-$(tr -d '\r\n' < "$W/bff-stamp.txt" 2>/dev/null)}"
: > "$OUT"

PASS=0; FAIL=0
# -i matters (see the Go lane's first run): without it `docker exec` closes stdin and a `-f -` script runs zero
# statements while still exiting 0.
psqlx() { docker exec -i supabase_db_spotlight psql -U postgres -d postgres "$@"; }
jwt() { cat "$T/$1.jwt" 2>/dev/null; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }
dbq() { psqlx -Atc "$1" 2>/dev/null | tr -d '\r\n'; }

jget() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}if(Array.isArray(v)){console.log(v.join(","));process.exit(0)}console.log(v==null||v===undefined?"":v)' "$1" "$2" | tr -d '\r'; }
jlen() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log(0);process.exit(0)}const p=process.argv[2].split(".").filter(x=>x!=="");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(Array.isArray(v)?v.length:(v==null?0:1))' "$1" "$2"; }
# keys <file> <path|"." for the document itself> — which keys a document carries is the contract the app
# compiles against, so it is asserted rather than assumed.
keys() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const v=process.argv[2]==="."?j:process.argv[2].split(".").reduce((a,k)=>(a==null?a:a[k]),j);console.log(Object.keys(v||{}).sort().join(","))' "$1" "$2" | tr -d '\r'; }
ids() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((j.data||[]).map(n=>n.id).join("\n"))' "$1"; }

call() {
  local label=$1 method=$2 path=$3 body=${4:-}
  if [ -n "$body" ]; then
    CODE=$(curl -sS -m 60 -o "$W/resp-bff.json" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $(jwt "$label")" -H 'Content-Type: application/json' -d "$body")
  else
    CODE=$(curl -sS -m 60 -o "$W/resp-bff.json" -w '%{http_code}' -X "$method" "$BASE$path" \
      -H "Authorization: Bearer $(jwt "$label")")
  fi
}

expect() { # expect <want_code> <who> <METHOD> <path> [body] <description>
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  local msg; msg=$(jget "$W/resp-bff.json" error)
  printf '%-4s want=%s got=%s  [%s as %s] %s\n' \
    "$( [ "$CODE" = "$want" ] && echo PASS || echo FAIL )" "$want" "$CODE" "$desc" "$who" "${msg:+— $msg}" | tee -a "$OUT"
  if [ "$CODE" = "$want" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

want() { # want <description> <got> <want>
  local ok=PASS
  # empty-vs-empty is a lookup that returned nothing, not evidence — fail it.
  if [ "$2" = "$3" ]; then [ -z "$2" ] && ok=EMPTY; else ok=FAIL; fi
  printf '%-4s %s — got "%s" want "%s"\n' "$([ "$ok" = PASS ] && echo PASS || echo FAIL )" "$1" "$2" "$3" | tee -a "$OUT"
  case "$ok" in PASS) PASS=$((PASS+1));; *) FAIL=$((FAIL+1));; esac
  [ "$ok" = EMPTY ] && note "  ^ both sides empty: the value was never read"
  return 0
}

wantsub() { # wantsub <description> <pattern>
  local ok=PASS; grep -q -- "$2" "$W/resp-bff.json" || ok=FAIL
  printf '%-4s %s — body %s "%s"\n' "$ok" "$1" "$( [ "$ok" = PASS ] && echo contains || echo MISSING )" "$2" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

verdict() { # verdict <description> <ok:0|1> <detail>
  printf '%-4s %s — %s\n' "$( [ "$2" = 0 ] && echo PASS || echo FAIL )" "$1" "$3" | tee -a "$OUT"
  if [ "$2" = 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

want_empty() { # want_empty <description> <got> <a value that must be present in the same document>
  if [ -z "$3" ]; then
    want "$1 (guard value missing — the response never parsed)" "absent" "present"
    return 0
  fi
  want "$1" "${2:-absent}" "absent"
}

nid() { dbq "select id from estate_notifications where estate_id='$ESTATE' and title='$1' limit 1"; }
db_flag() { dbq "select case when ($2) then 't' else 'f' end from estate_notifications where id='$1'"; }
db_val() { dbq "select coalesce(($2)::text,'·') from estate_notifications where id='$1'"; }
db_state() { # <user> -> '<active> <archived> <all>'
  local u=$1
  printf '%s %s %s' \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u' and archived_at is null")" \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u' and archived_at is not null")" \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u'")"
}
db_unread_active() {
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$1'
         and archived_at is null and read_at is null"
}
# The sweep's own WHERE, so every sweep expectation is derived from the rows rather than from a number this
# file hoped for. `..._for` is the same predicate narrowed to one recipient, because the sweep is estate-wide
# while the inbox a member reads is not.
db_archive_eligible() { # <days> <quoted keep list>
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and archived_at is null
         and read_at is not null and not pinned and category <> ALL (ARRAY[$2])
         and created_at < NOW() - make_interval(days => $1)"
}
db_archive_eligible_for() { # <user> <days> <quoted keep list>
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$1'
         and archived_at is null and read_at is not null and not pinned
         and category <> ALL (ARRAY[$3]) and created_at < NOW() - make_interval(days => $2)"
}
db_purge_eligible() {
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and archived_at is not null
         and not pinned and category <> ALL (ARRAY[$2]) and archived_at < NOW() - make_interval(days => $1)"
}
db_row() { dbq "select count(*) from estate_notifications where id='$1'"; }
db_audit() { dbq "select count(*) from estate_audit_log where estate_id='$ESTATE' and action='$1'"; }

RES=$(uid inboxres); ADMIN=$(uid inboxadmin); NONE=$(uid inboxnone); OUTSIDER=$(uid nobody)
if [ -z "$RES" ] || [ -z "$ADMIN" ] || [ -z "$NONE" ] || [ -z "$STAMP" ]; then
  printf 'ABORT missing inbox tokens or lane stamp\n' | tee -a "$OUT"; exit 90
fi

note "=== estate notification BFF API_LIVE probe @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE stamp=$STAMP"
note "inbox-res=$RES inbox-admin=$ADMIN inbox-none=$NONE (unused outsider=$OUTSIDER)"

note "--- 1. preflight: the surface on BASE is Phase 2.5a code, the lane estate, and the single-membership guarantee"
# Which code is answering has to be known before ~150 contract assertions mean anything, and the feed
# envelope is the cheapest probe for it: before Phase 2.5a the BFF answered a bare newest-100 array with no
# total/limit/offset/state/unread_only. This guard exists because the first real run of this file could not
# tell a stale server apart from a wrong identity — it reported both as contract failures. The envelope is
# the server's fingerprint; the membership counts below are the caller's; a mismatch aborts instead of
# producing a transcript of false evidence.
call inboxres GET "/api/v1/estate/notifications?limit=1"
if [ "$CODE" != 200 ] || [ "$(keys "$W/resp-bff.json" .)" != "data,limit,offset,state,total,unread_only" ]; then
  note "ABORT: $BASE did not answer with the paging envelope (code=$CODE keys=$(keys "$W/resp-bff.json" .))"
  note "  ^ that server is not this checkout's inbox code; re-run through 08b-run-web.sh"
  exit 93
fi
note "server check: $BASE answers the Phase 2.5a feed envelope"

# getResidentContext resolves a caller's estate as `.eq('user_id', …).limit(1)` with no ORDER BY, so every
# "which estate" assertion below is only meaningful while these identities hold exactly one membership each,
# and the 403 assertions only meaningful while inboxnone holds none.
MEMB_ADMIN=$(dbq "select count(*) from estate_residents where user_id='$ADMIN' and banned_at is null and deleted_at is null")
MEMB_RES=$(dbq "select count(*) from estate_residents where user_id='$RES' and banned_at is null and deleted_at is null")
MEMB_NONE=$(dbq "select count(*) from estate_residents where user_id='$NONE' and banned_at is null and deleted_at is null")
verdict "inbox-admin holds exactly one estate membership" "$([ "$MEMB_ADMIN" = 1 ] && echo 0 || echo 1)" "count=$MEMB_ADMIN"
verdict "inbox-res holds exactly one estate membership" "$([ "$MEMB_RES" = 1 ] && echo 0 || echo 1)" "count=$MEMB_RES"
verdict "inbox-none holds no estate membership" "$([ "$MEMB_NONE" = 0 ] && echo 0 || echo 1)" "count=$MEMB_NONE"
verdict "the outsider identity this lane no longer uses does hold memberships (why inboxnone exists)" \
  "$([ "$(dbq "select count(*) from estate_residents where user_id='$OUTSIDER' and banned_at is null and deleted_at is null")" -gt 0 ] && echo 0 || echo 1)" \
  "nobody is a member of closed estates from earlier lanes, so it cannot prove the 403 branch"
if [ "$MEMB_ADMIN" != 1 ] || [ "$MEMB_RES" != 1 ] || [ "$MEMB_NONE" != 0 ]; then
  note "ABORT: a stale membership makes every estate assertion below ambiguous"; exit 91
fi

ESTATE=$(dbq "select estate_id from estate_residents where user_id='$ADMIN' limit 1")
SAME=$(dbq "select estate_id from estate_residents where user_id='$RES' limit 1")
verdict "both identities resolve to the same lane estate" "$([ -n "$ESTATE" ] && [ "$ESTATE" = "$SAME" ] && echo 0 || echo 1)" "estate=$ESTATE"
want "the lane estate is the seeded BFF one" \
  "$(dbq "select name from estates where id='$ESTATE'")" "UAT Inbox BFF Estate $STAMP"
want "estate status as seeded (the lifecycle mirror needs a non-active estate)" \
  "$(dbq "select status from estates where id='$ESTATE'")" "pending"
want "fixture shape: 67 active rows in the recipient's inbox" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null")" "67"
want "fixture shape: 4 rows already archived" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null")" "4"
want "fixture shape: the other estate holds one eligible row" \
  "$(dbq "select count(*) from estate_notifications where title='UAT25b 31 other estate'")" "1"
OTHER=$(dbq "select id from estate_notifications where title='UAT25b 31 other estate' limit 1")
OTHER_ESTATE=$(dbq "select estate_id from estate_notifications where id='$OTHER'")
verdict "that row lives in a different estate" "$([ -n "$OTHER_ESTATE" ] && [ "$OTHER_ESTATE" != "$ESTATE" ] && echo 0 || echo 1)" "other=$OTHER_ESTATE"

N01=$(nid 'UAT25b 01 pinned twenty'); N02=$(nid 'UAT25b 02 old general read')
N03=$(nid 'UAT25b 03 old security read'); N05=$(nid 'UAT25b 05 old general unread')
N06=$(nid 'UAT25b 06 body-only token'); N07=$(nid 'UAT25b 07 mid maintenance')
N08=$(nid 'UAT25b 08 newest general'); N11=$(nid 'UAT25b 11 archived old general')
N12=$(nid 'UAT25b 12 archived pinned'); N13=$(nid 'UAT25b 13 archived security')
N14=$(nid 'UAT25b 14 archived unread'); N21=$(nid 'UAT25b 21 admin copy')
MISSING_IDS=""
for v in N01 N02 N03 N05 N06 N07 N08 N11 N12 N13 N14 N21; do
  [ -n "${!v}" ] || MISSING_IDS="$MISSING_IDS $v"
done
verdict "all twelve labelled fixtures resolved by exact title" "$([ -z "$MISSING_IDS" ] && echo 0 || echo 1)" "missing:${MISSING_IDS:- none}"
if [ -n "$MISSING_IDS" ]; then note "ABORT before asserting against half a fixture set"; exit 92; fi

note "--- 2. who may reach the inbox at all, and where the estate comes from"
expect 401 "" GET "/api/v1/estate/notifications" "no token at all"
expect 401 "" GET "/api/v1/estate/notifications/unread-count" "no token at all (badge)"
expect 401 "" POST "/api/v1/estate/notifications/read-all" "no token at all (read-all)"
expect 401 "" GET "/api/v1/estate/notifications/retention" "no token at all (schedule)"
expect 403 inboxnone GET "/api/v1/estate/notifications" "an identity with no estate membership"
want "and the reason is membership, not rows" "$(jget "$W/resp-bff.json" error)" "Not a resident of any estate"
expect 403 inboxnone GET "/api/v1/estate/notifications/retention" "an outsider cannot read the schedule"
want "for the same reason" "$(jget "$W/resp-bff.json" error)" "Not a resident of any estate"
expect 403 inboxnone POST "/api/v1/estate/notifications/read-all" '{}' "an outsider cannot stamp reads"
# The badge is the one estate route that answers 200 to a non-resident: it returns {count:0}, because the app
# draws it before it knows whether the user lives in an estate. Recorded in the README's divergence list, and
# asserted here so that changing it later is a decision rather than a surprise.
expect 200 inboxnone GET "/api/v1/estate/notifications/unread-count" "the badge answers a non-resident with zero"
want "badge count for a non-resident" "$(jget "$W/resp-bff.json" count)" "0"

expect 200 inboxres GET "/api/v1/estate/notifications?estate_id=$OTHER_ESTATE&limit=1" "another estate's id in the query is not a switch"
want "and the row it returned still belongs to the caller" "$(jget "$W/resp-bff.json" data.0.estateId)" "$ESTATE"
expect 200 inboxres GET "/api/v1/estate/notifications?estate_id=not-a-uuid&limit=1" "a malformed estate_id is inert, not a 500"
want "and still the caller's estate" "$(jget "$W/resp-bff.json" data.0.estateId)" "$ESTATE"

note "--- 3. the lifecycle mirror on a pending estate (the BFF half of ESTD-D025)"
# Reads stay open; every write must answer 423 — including PUT /retention and POST /retention/run, which is
# what this phase added to the BFF (the Go route for the same change has always sat behind LifecycleGate).
STATE_BEFORE=$(db_state "$RES")
POLICY_ROWS_BEFORE=$(dbq "select count(*) from estate_notification_retention_policies where estate_id='$ESTATE'")
expect 200 inboxres GET "/api/v1/estate/notifications?state=all" "a pending estate still answers the inbox read"
expect 200 inboxres GET "/api/v1/estate/notifications/unread-count" "a pending estate still answers the badge"
expect 200 inboxadmin GET "/api/v1/estate/notifications/retention" "a pending estate still answers the schedule read"
expect 423 inboxres POST "/api/v1/estate/notifications/$N05/read" '{}' "pending estate takes no read stamp"
wantsub "and it says why" "Estate is pending — changes are disabled until it is active"
expect 423 inboxres POST "/api/v1/estate/notifications/$N05/archive" '{"archived":true}' "pending estate takes no archive"
expect 423 inboxres POST "/api/v1/estate/notifications/$N05/pin" '{"pinned":true}' "pending estate takes no pin"
expect 423 inboxres POST "/api/v1/estate/notifications/read-all" '{}' "pending estate takes no bulk read"
expect 423 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":200}' "pending estate takes no schedule write"
expect 423 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "pending estate takes no sweep"
want "and none of those attempts moved a row" "$(db_state "$RES")" "$STATE_BEFORE"
want "and no schedule row was written" \
  "$(dbq "select count(*) from estate_notification_retention_policies where estate_id='$ESTATE'")" "$POLICY_ROWS_BEFORE"
want "and neither write was audited" \
  "$(dbq "select count(*) from estate_audit_log where estate_id='$ESTATE' and action like 'NOTIFICATION_RETENTION%'")" "0"
want "and the unread row is still unread" "$(db_flag "$N05" "read_at is null")" "t"
want "and the two seeded pins are still the only pins" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and pinned")" "2"

note "--- 4. the same calls once the estate is active"
# The flip is done in SQL, not over HTTP: 06 section 2 drove pending -> active -> suspended -> closed through
# /estate-admin/estates/:id/lifecycle against the same estates row this route reads. What is under test here
# is the *status* changing so the gate's answer changes.
dbq "UPDATE estates SET status='active' WHERE id='$ESTATE'" >/dev/null
want "estate is active" "$(dbq "select status from estates where id='$ESTATE'")" "active"
expect 200 inboxres GET "/api/v1/estate/notifications" "the feed still answers"
expect 200 inboxres POST "/api/v1/estate/notifications/$N05/read" '{}' "the read stamp that was 423 is now 200"
want "and it actually stamped it" "$(db_flag "$N05" "read_at is not null")" "t"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":90}' "the schedule write that was 423 is now 200"
want "and the row exists now" \
  "$(dbq "select count(*) from estate_notification_retention_policies where estate_id='$ESTATE'")" "1"
want "with the horizon that was sent" \
  "$(dbq "select archive_after_days from estate_notification_retention_policies where estate_id='$ESTATE'")" "90"
note "  (the 204 read-all and the sweep's 200 are proven in sections 14 and 16, where their row effects can be read)"

note "--- 5. the document shape: a paging envelope around the app's camelCase item"
call inboxres GET "/api/v1/estate/notifications?limit=3"
want "envelope keys" "$(keys "$W/resp-bff.json" ".")" "data,limit,offset,state,total,unread_only"
want "item keys (a row with no deep link and no archive stamp carries neither key)" \
  "$(keys "$W/resp-bff.json" data.0)" "body,category,createdAt,estateId,id,pinned,readAt,title"
want_empty "the Go item keys are not this contract: no created_at (category proves the row parsed)" \
  "$(jget "$W/resp-bff.json" data.0.created_at)" "$(jget "$W/resp-bff.json" data.0.category)"
want_empty "no estate_id" "$(jget "$W/resp-bff.json" data.0.estate_id)" "$(jget "$W/resp-bff.json" data.0.estateId)"
want_empty "and no kind alias for category" "$(jget "$W/resp-bff.json" data.0.kind)" "$(jget "$W/resp-bff.json" data.0.category)"
want "state echoes the selector" "$(jget "$W/resp-bff.json" state)" "active"
want "limit echoes what was asked" "$(jget "$W/resp-bff.json" limit)" "3"
want "offset echoes what was asked" "$(jget "$W/resp-bff.json" offset)" "0"
call inboxres GET "/api/v1/estate/notifications?q=service%20window&limit=3"
want "a row that has a deep link carries deepLink" "$(jget "$W/resp-bff.json" data.0.deepLink)" "/estate/maintenance/77"
want "and it is camelCase all the way down" \
  "$(keys "$W/resp-bff.json" data.0)" "body,category,createdAt,deepLink,estateId,id,pinned,readAt,title"

note "--- 6. selector validation, on the surface the app actually calls"
expect 400 inboxres GET "/api/v1/estate/notifications?state=inbox" "an unknown state is a caller mistake"
want "state message" "$(jget "$W/resp-bff.json" error)" "state must be active, archived or all"
expect 400 inboxres GET "/api/v1/estate/notifications?category=emergencz" "an unknown category is a caller mistake"
want "category message" "$(jget "$W/resp-bff.json" error)" "Unknown notification category"
expect 400 inboxres GET "/api/v1/estate/notifications?q=k" "a one-character search is refused"
want "search-length message" "$(jget "$W/resp-bff.json" error)" "A search term of at least 2 characters is required"
expect 400 inboxres GET "/api/v1/estate/notifications?q=%25" "a lone wildcard is refused by length before grammar"
want "same reason" "$(jget "$W/resp-bff.json" error)" "A search term of at least 2 characters is required"
expect 400 inboxres GET "/api/v1/estate/notifications?q=kairos%2Cdeposit" "a comma would be parsed as a second filter"
want "and the message says so" "$(jget "$W/resp-bff.json" error)" "A search term may not contain , ( or )"
expect 400 inboxres GET "/api/v1/estate/notifications?q=a%28b" "parentheses are PostgREST separators too"
want "same rule" "$(jget "$W/resp-bff.json" error)" "A search term may not contain , ( or )"
expect 400 inboxres GET "/api/v1/estate/notifications?limit=0" "limit 0 is not 'no limit'"
want "limit message" "$(jget "$W/resp-bff.json" error)" "limit must be between 1 and 200"
expect 400 inboxres GET "/api/v1/estate/notifications?limit=201" "the ceiling is 200"
expect 400 inboxres GET "/api/v1/estate/notifications?limit=abc" "a non-integer limit is refused"
expect 400 inboxres GET "/api/v1/estate/notifications?limit=12.5" "and a fractional one"
expect 200 inboxres GET "/api/v1/estate/notifications?offset=-5" "a negative offset is read as 0, not an error"
want "and the envelope says which offset it used" "$(jget "$W/resp-bff.json" offset)" "0"
expect 200 inboxres GET "/api/v1/estate/notifications?unread_only=1&limit=200" "unread_only accepts the truthy spellings"
want "and reports it back" "$(jget "$W/resp-bff.json" unread_only)" "true"
expect 200 inboxres GET "/api/v1/estate/notifications?unread_only=maybe&limit=200" "anything else reads as false"
want "reported as false" "$(jget "$W/resp-bff.json" unread_only)" "false"

note "--- 7. paging: total is the number the flat list could not tell you"
TOTAL_DB=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null")
call inboxres GET "/api/v1/estate/notifications"
want "default page size" "$(jget "$W/resp-bff.json" limit)" "50"
want "page length equals the limit" "$(jlen "$W/resp-bff.json" data)" "50"
want "total is the whole matching set, not the page" "$(jget "$W/resp-bff.json" total)" "$TOTAL_DB"
verdict "total is larger than the page, so the truncation is visible" "$([ "$TOTAL_DB" -gt 50 ] && echo 0 || echo 1)" "total=$TOTAL_DB page=50"
call inboxres GET "/api/v1/estate/notifications?limit=200"
want "the ceiling is honoured" "$(jlen "$W/resp-bff.json" data)" "$TOTAL_DB"
want "and total is unchanged by the page size" "$(jget "$W/resp-bff.json" total)" "$TOTAL_DB"
call inboxres GET "/api/v1/estate/notifications?limit=50"
ids "$W/resp-bff.json" | sort > "$W/page-1.txt"
call inboxres GET "/api/v1/estate/notifications?offset=50&limit=50"
want "the tail page holds what the head page could not" "$(jlen "$W/resp-bff.json" data)" "$((TOTAL_DB-50))"
ids "$W/resp-bff.json" | sort > "$W/page-2.txt"
OVERLAP=$(comm -12 "$W/page-1.txt" "$W/page-2.txt" | grep -c . || true)
verdict "the two pages share no row" "$([ "$OVERLAP" = 0 ] && echo 0 || echo 1)" "shared ids=$OVERLAP"
UNION=$(sort -u "$W/page-1.txt" "$W/page-2.txt" | grep -c . || true)
want "and together they are the whole inbox" "$UNION" "$TOTAL_DB"
expect 200 inboxres GET "/api/v1/estate/notifications?offset=900&limit=10" "reading past the end is a page, not an error"
want "and the page is empty" "$(jlen "$W/resp-bff.json" data)" "0"
want "with total still stating the real size" "$(jget "$W/resp-bff.json" total)" "$TOTAL_DB"

note "--- 8. ordering: pinned first, newest next, and the same rule under paging"
DB_ORDER=$(dbq "select string_agg(id::text,',') from (select id from estate_notifications
  where estate_id='$ESTATE' and user_id='$RES' and archived_at is null
  order by pinned desc, created_at desc limit 5) x")
call inboxres GET "/api/v1/estate/notifications?limit=5"
want "the first five rows are the database's first five for the same selector" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.map(n=>n.id).join(","))' "$W/resp-bff.json")" "$DB_ORDER"
want "and the pinned notice leads them although it is 200 days old" "$(jget "$W/resp-bff.json" data.0.id)" "$N01"
want "one pinned row on the page" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.filter(n=>n.pinned).length)' "$W/resp-bff.json")" "1"
DB_TAIL=$(dbq "select string_agg(id::text,',') from (select id from estate_notifications
  where estate_id='$ESTATE' and user_id='$RES' and archived_at is null
  order by pinned desc, created_at desc offset 50 limit 5) x")
call inboxres GET "/api/v1/estate/notifications?offset=50&limit=5"
want "the rule holds past the first page (a pinned row is never displaced by an offset)" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.map(n=>n.id).join(","))' "$W/resp-bff.json")" "$DB_TAIL"
want "and what leads the second page is not pinned" "$(db_flag "$(jget "$W/resp-bff.json" data.0.id)" "not pinned")" "t"

note "--- 9. the two halves, the unread filter, and the badge"
A=$(db_state "$RES"); ACTIVE=${A%% *}; REST=${A#* }; ARCHIVED=${REST%% *}; ALLROWS=${REST##* }
call inboxres GET "/api/v1/estate/notifications?state=active&limit=200"
want "active total from the API" "$(jget "$W/resp-bff.json" total)" "$ACTIVE"
call inboxres GET "/api/v1/estate/notifications?state=archived&limit=200"
want "archived total from the API" "$(jget "$W/resp-bff.json" total)" "$ARCHIVED"
# Hold on to that document: resp-bff.json is overwritten by every call, and the four assertions below this
# one are about the archived page, not about whatever was read last. Reading the wrong document here once
# reported the archived view as starting with an ACTIVE pinned row.
cp "$W/resp-bff.json" "$W/arch-page.json"
call inboxres GET "/api/v1/estate/notifications?state=all&limit=200"
want "all = the recipient's whole row set" "$(jget "$W/resp-bff.json" total)" "$ALLROWS"
verdict "the halves add up to the whole" "$([ "$((ACTIVE+ARCHIVED))" = "$ALLROWS" ] && echo 0 || echo 1)" "$ACTIVE + $ARCHIVED = $ALLROWS"
ARCH_LABELS=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.map(n=>n.title.slice(7,9)).join(","))' "$W/arch-page.json")
want "the archived view leads with the pinned row, then the rest newest-first" \
  "$(node -e 'console.log(process.argv[1].split(",").slice(0,2).join(","))' "$ARCH_LABELS")" "12,11"
want "every row of the archived page carries an archivedAt" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.every(n=>!!n.archivedAt))' "$W/arch-page.json")" "true"
want "and no active row leaked into it" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.filter(n=>n.archivedAt).length)' "$W/arch-page.json")" "$ARCHIVED"
call inboxres GET "/api/v1/estate/notifications?state=active&category=announcement&limit=200"
want "category filter is exact" "$(jget "$W/resp-bff.json" total)" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null and category='announcement'")"
want "and every row it returned is that category" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.every(n=>n.category==="announcement"))' "$W/resp-bff.json")" "true"
call inboxres GET "/api/v1/estate/notifications?state=all&category=security&limit=200"
want "state and category compose" "$(jget "$W/resp-bff.json" total)" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and category='security'")"
call inboxres GET "/api/v1/estate/notifications?unread_only=1&limit=200"
want "unread_only agrees with the database" "$(jget "$W/resp-bff.json" total)" "$(db_unread_active "$RES")"
want "and none of them is read" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.every(n=>!n.readAt))' "$W/resp-bff.json")" "true"
expect 200 inboxres GET "/api/v1/estate/notifications/unread-count" "the badge"
want "badge == the database's unread ACTIVE count" "$(jget "$W/resp-bff.json" count)" "$(db_unread_active "$RES")"
ARCHIVED_UNREAD=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and read_at is null and archived_at is not null")
verdict "an archived unread row exists, so the badge is not the whole unread set" \
  "$([ "$ARCHIVED_UNREAD" -gt 0 ] && echo 0 || echo 1)" "archived-unread=$ARCHIVED_UNREAD badge=$(jget "$W/resp-bff.json" count) unread-active=$(db_unread_active "$RES")"

note "--- 10. search reaches the body, not only the title"
call inboxres GET "/api/v1/estate/notifications?q=kairos&limit=10"
want "a token that appears only in a body still matches" "$(jget "$W/resp-bff.json" total)" "1"
want "and it is the row the seed put it in" "$(jget "$W/resp-bff.json" data.0.id)" "$N06"
want "whose title does not contain the term" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(/kairos/i.test(j.data[0].title))' "$W/resp-bff.json")" "false"
want "but its body does" "$(db_flag "$N06" "body ilike '%kairos%'")" "t"
call inboxres GET "/api/v1/estate/notifications?q=pinned%20twenty&limit=10"
want "a two-word title query matches" "$(jget "$W/resp-bff.json" total)" "1"
want "and it is the pinned fixture" "$(jget "$W/resp-bff.json" data.0.id)" "$N01"
call inboxres GET "/api/v1/estate/notifications?q=generator%20deposit&state=all&limit=10"
want "a phrase across body words matches" "$(jget "$W/resp-bff.json" total)" "1"
call inboxres GET "/api/v1/estate/notifications?q=zzzcarnegie&limit=10"
want "a term nothing holds is an empty page, not an error" "$(jget "$W/resp-bff.json" total)" "0"
want "and the page is empty" "$(jlen "$W/resp-bff.json" data)" "0"
call inboxres GET "/api/v1/estate/notifications?q=archived&state=all&limit=20"
want "search spans the archived half when asked" \
  "$(jget "$W/resp-bff.json" total)" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and (title ilike '%archived%' or body ilike '%archived%')")"
call inboxres GET "/api/v1/estate/notifications?q=two%20hundred&state=all&limit=20"
want "body search across both halves" \
  "$(jget "$W/resp-bff.json" total)" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and (title ilike '%two%hundred%' or body ilike '%two%hundred%')")"

note "--- 11. the read stamp is written once and never moved"
dbq "UPDATE estate_notifications SET read_at = '2026-03-04T05:06:07Z'::timestamptz WHERE id='$N05'" >/dev/null
SEED_EPOCH=$(db_val "$N05" "floor(extract(epoch from read_at))::bigint")
expect 200 inboxres POST "/api/v1/estate/notifications/$N05/read" '{}' "re-reading a read notice is not an error"
want "the stamp did not move" "$(db_val "$N05" "floor(extract(epoch from read_at))::bigint")" "$SEED_EPOCH"
want "and the document it returned says the same instant" \
  "$(node -e 'console.log(Math.floor(Date.parse(process.argv[1])/1000))' "$(jget "$W/resp-bff.json" readAt)")" "$SEED_EPOCH"
want "the returned document is the row" "$(jget "$W/resp-bff.json" id)" "$N05"
want "with its label still readable" "$(jget "$W/resp-bff.json" title)" "UAT25b 05 old general unread"
expect 400 inboxres POST "/api/v1/estate/notifications/not-a-uuid/read" '{}' "a malformed id is a caller mistake"
want "and the message names the id" "$(jget "$W/resp-bff.json" error)" "Invalid notification ID"
expect 404 inboxres POST "/api/v1/estate/notifications/$N21/read" '{}' "the admin's copy is not the caller's row"
want "and the answer is 'not found', which does not confirm the row exists" "$(jget "$W/resp-bff.json" error)" "Notification not found"
expect 404 inboxres POST "/api/v1/estate/notifications/$OTHER/read" '{}' "another estate's row is the same 404"
want "and that row was not touched" "$(db_flag "$OTHER" "read_at is not null")" "t"
expect 403 inboxnone POST "/api/v1/estate/notifications/$N08/read" '{}' "a non-resident is stopped before the row is looked up"
want "which is the opposite order to Go's row-scoped 404 (documented divergence)" "$(jget "$W/resp-bff.json" error)" "Not a resident of any estate"
want "and the stranger's attempt stamped nothing" "$(db_flag "$N08" "read_at is null")" "t"

note "--- 12. the archive round trip is reversible and loses nothing"
READ_EPOCH=$(db_val "$N07" "floor(extract(epoch from read_at))::bigint")
expect 200 inboxres POST "/api/v1/estate/notifications/$N07/archive" '{}' "archiving with no body means archived=true"
want "the row carries an archive stamp now" "$(db_flag "$N07" "archived_at is not null")" "t"
want "the deep link survived the trip" "$(jget "$W/resp-bff.json" deepLink)" "/estate/maintenance/77"
want "and so did the read stamp" "$(db_val "$N07" "floor(extract(epoch from read_at))::bigint")" "$READ_EPOCH"
want "and the category is untouched" "$(jget "$W/resp-bff.json" category)" "maintenance"
call inboxres GET "/api/v1/estate/notifications?limit=200"
want "the archived row left the active page" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.some(n=>n.id===process.argv[2]))' "$W/resp-bff.json" "$N07")" "false"
want "and total dropped by exactly one" "$(jget "$W/resp-bff.json" total)" "$((TOTAL_DB-1))"
call inboxres GET "/api/v1/estate/notifications?state=archived&limit=200"
want "and appeared in the archived page" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.some(n=>n.id===process.argv[2]))' "$W/resp-bff.json" "$N07")" "true"
expect 200 inboxres POST "/api/v1/estate/notifications/$N07/archive" '{"archived":false}' "un-archiving is the same route with the flag off"
want_empty "and the archive stamp is gone (readAt proves the document parsed)" \
  "$(jget "$W/resp-bff.json" archivedAt)" "$(jget "$W/resp-bff.json" readAt)"
want "the read stamp was never touched by the un-archive" "$(db_val "$N07" "floor(extract(epoch from read_at))::bigint")" "$READ_EPOCH"
want "the row is still there" "$(db_row "$N07")" "1"
call inboxres GET "/api/v1/estate/notifications?limit=200"
want "and it is back in the inbox" "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.some(n=>n.id===process.argv[2]))' "$W/resp-bff.json" "$N07")" "true"
want "with the page total back where it started" "$(jget "$W/resp-bff.json" total)" "$TOTAL_DB"
expect 404 inboxres POST "/api/v1/estate/notifications/$N21/archive" '{"archived":true}' "a resident cannot archive the admin's copy"
want "and that row is exactly as it was" "$(db_flag "$N21" "archived_at is null")" "t"

note "--- 13. pinning: a personal flag, and an estate admin's retention decision"
expect 200 inboxres POST "/api/v1/estate/notifications/$N08/pin" '{"pinned":true}' "a member pins their own notice"
want "the flag is on the row" "$(db_flag "$N08" "pinned")" "t"
call inboxres GET "/api/v1/estate/notifications?limit=3"
want "and it now leads the feed" "$(jget "$W/resp-bff.json" data.0.id)" "$N08"
expect 200 inboxres POST "/api/v1/estate/notifications/$N08/pin" '{"pinned":false}' "un-pinning is the same route"
want "the flag is off" "$(db_flag "$N08" "not pinned")" "t"
expect 404 inboxres POST "/api/v1/estate/notifications/$N21/pin" "{\"pinned\":true,\"user_id\":\"$RES\"}" "a member naming themselves on another recipient's row does not get that row"
want "and the answer is the owner-scoped 404, identical to pinning the row without naming anyone" "$(jget "$W/resp-bff.json" error)" "Notification not found"
# This is NOT a divergence case: Go's SetNotificationPinned folds an empty target and a self-target into
# "act for yourself", then falls through to the same own-row check, so both surfaces answer 404 here. The
# divergence this lane does document is the opposite order for a NON-RESIDENT (section 11: BFF 403 before
# the row is looked up, Go's row-scoped 404).
want "and the admin's copy is untouched" "$(db_flag "$N21" "not pinned")" "t"
expect 403 inboxres POST "/api/v1/estate/notifications/$N21/pin" '{"pinned":true,"user_id":"00000000-0000-4000-8000-000000000000"}' "a member naming a stranger is also 403"
want "and the refusal never reached the row" "$(db_flag "$N21" "not pinned")" "t"
expect 400 inboxadmin POST "/api/v1/estate/notifications/$N02/pin" "{\"pinned\":true,\"user_id\":\"not-a-uuid\"}" "an admin's target must be an id"
want "and the message names the target" "$(jget "$W/resp-bff.json" error)" "Invalid user ID"
expect 200 inboxadmin POST "/api/v1/estate/notifications/$N02/pin" "{\"pinned\":true,\"user_id\":\"$RES\"}" "an estate admin pins a member's copy"
want "on the member's row" "$(db_flag "$N02" "pinned")" "t"
want "and not on the admin's own copy" "$(db_flag "$N21" "not pinned")" "t"
expect 200 inboxadmin POST "/api/v1/estate/notifications/$N21/pin" '{"pinned":true}' "an admin pins their own copy without naming anyone"
want "which is the admin's row" "$(db_flag "$N21" "pinned")" "t"
expect 200 inboxadmin POST "/api/v1/estate/notifications/$N21/pin" '{"pinned":false}' "and un-pins it again"
want "off again" "$(db_flag "$N21" "not pinned")" "t"
expect 404 inboxadmin POST "/api/v1/estate/notifications/$N07/pin" '{"pinned":true}' "an admin acting without user_id on a member's row is 404"
want "because that id is not one of the admin's rows" "$(jget "$W/resp-bff.json" error)" "Notification not found"
want "and the member's row kept its flag" "$(db_flag "$N07" "not pinned")" "t"
expect 200 inboxadmin POST "/api/v1/estate/notifications/$N02/pin" "{\"pinned\":false,\"user_id\":\"$RES\"}" "and the on-behalf un-pin releases it"
want "the sweep's exemption is gone" "$(db_flag "$N02" "not pinned")" "t"
want "only the two seeded pins remain (01 active, 12 archived)" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and pinned")" "2"

note "--- 14. read-all stops at the edge of the archive"
UNREAD_ACTIVE_BEFORE=$(db_unread_active "$RES")
ARCHIVED_UNREAD_BEFORE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null and read_at is null")
verdict "there are unread rows in both halves" "$([ "$UNREAD_ACTIVE_BEFORE" -gt 0 ] && [ "$ARCHIVED_UNREAD_BEFORE" -gt 0 ] && echo 0 || echo 1)" "active=$UNREAD_ACTIVE_BEFORE archived=$ARCHIVED_UNREAD_BEFORE"
ADMIN_UNREAD_BEFORE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$ADMIN' and read_at is null")
expect 204 inboxres POST "/api/v1/estate/notifications/read-all" '{}' "read-all answers 204"
want "with no body" "$(wc -c < "$W/resp-bff.json" | tr -d ' ')" "0"
want "the inbox half is fully read" "$(db_unread_active "$RES")" "0"
want "the archive half still holds its unread rows" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null and read_at is null")" "$ARCHIVED_UNREAD_BEFORE"
want "row 14 is the archived unread one, still unread" "$(db_flag "$N14" "read_at is null")" "t"
want "and still archived" "$(db_flag "$N14" "archived_at is not null")" "t"
want "a bulk row was stamped for real" \
  "$(db_flag "$(dbq "select id from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and title='UAT25b bulk 01'")" "read_at is not null")" "t"
want "and exactly the previously-unread rows got a fresh stamp" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null and read_at >= NOW() - interval '10 minutes'")" "$UNREAD_ACTIVE_BEFORE"
note "  (row 05 is in neither number: section 4 read it and section 11 re-dated it to a 2026-03-04 instant, so it is read but not freshly stamped — and it was already out of the unread count before read-all ran)"
expect 200 inboxres GET "/api/v1/estate/notifications/unread-count" "the badge is empty afterwards"
want "count 0" "$(jget "$W/resp-bff.json" count)" "0"
expect 204 inboxadmin POST "/api/v1/estate/notifications/read-all" '{}' "read-all is per recipient, not per estate"
want "the admin's own unread copy is now read" "$(db_flag "$N21" "read_at is not null")" "t"
want "which the resident's read-all had not touched" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$ADMIN' and read_at is not null")" "$((ADMIN_UNREAD_BEFORE + 1))"
expect 204 inboxres POST "/api/v1/estate/notifications/read-all" '{}' "pressing it again is safe"
want "and it stamped nothing new" "$(db_unread_active "$RES")" "0"

note "--- 15. the retention plane: who may read it, and what it will accept"
expect 403 inboxres GET "/api/v1/estate/notifications/retention" "a member cannot read the schedule"
want "and the reason is the role" "$(jget "$W/resp-bff.json" error)" "Admin access required"
expect 403 inboxres PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":90}' "a member cannot move it"
want "for the same reason" "$(jget "$W/resp-bff.json" error)" "Admin access required"
expect 403 inboxres POST "/api/v1/estate/notifications/retention/run" '{}' "a member cannot run it"
want "again the role, not the lifecycle" "$(jget "$W/resp-bff.json" error)" "Admin access required"
SET_AUDIT_BEFORE=$(db_audit 'NOTIFICATION_RETENTION_SET')
expect 200 inboxadmin GET "/api/v1/estate/notifications/retention" "the admin reads it"
want "estate scoped by membership, not by the caller" "$(jget "$W/resp-bff.json" estate_id)" "$ESTATE"
want "the horizon the lane wrote" "$(jget "$W/resp-bff.json" archive_after_days)" "90"
want "enabled by default" "$(jget "$W/resp-bff.json" enabled)" "true"
want "keep list is the default pair" "$(jget "$W/resp-bff.json" keep_categories)" "security,system"
want "a written policy is not a default" "$(jget "$W/resp-bff.json" defaulted)" "false"
want "and it is attributed to whoever wrote it" "$(jget "$W/resp-bff.json" updated_by)" "$ADMIN"
want_empty "never-purge is absent, not 0" "$(jget "$W/resp-bff.json" purge_after_days)" "$(jget "$W/resp-bff.json" archive_after_days)"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"enabled":false}' "a patch that names one field"
want "keeps the horizon it was not asked about" "$(jget "$W/resp-bff.json" archive_after_days)" "90"
want "keeps the keep list" "$(jget "$W/resp-bff.json" keep_categories)" "security,system"
want "flips only what was sent" "$(jget "$W/resp-bff.json" enabled)" "false"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"enabled":true}' "and flips it back"
want "still 90 days" "$(jget "$W/resp-bff.json" archive_after_days)" "90"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"keep_categories":["payment","general","payment"]}' "a keep list is sent as a list, duplicates folded"
want "keep_categories REPLACES rather than merging" "$(jget "$W/resp-bff.json" keep_categories)" "payment,general"
want "so security is no longer protected" \
  "$(dbq "select keep_categories::text from estate_notification_retention_policies where estate_id='$ESTATE'")" "{payment,general}"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"keep_categories":["security","system"]}' "back to the default pair before the sweep"
want "and it is exactly the pair" "$(jget "$W/resp-bff.json" keep_categories)" "security,system"
want "each accepted write so far audited exactly one row" "$(db_audit 'NOTIFICATION_RETENTION_SET')" "$((SET_AUDIT_BEFORE + 4))"
# Re-sample here, immediately before the four rejects. The first run of this file compared the rejects
# against the section's opening baseline and reported 5-vs-1, which is true of the four accepted writes
# above it — not of the refusals. A refusal is only un-audited relative to the count before it.
SET_AUDIT_BEFORE_REJECTS=$(db_audit 'NOTIFICATION_RETENTION_SET')
expect 400 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":0}' "a zero horizon is refused"
wantsub "with the rule in the message" "Retention days must be positive and purge cannot be scheduled before archive"
expect 400 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":-5}' "and so is a negative one"
expect 400 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":200,"purge_after_days":50}' "a purge before the archive is refused"
expect 400 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"keep_categories":["emergencz"]}' "an invented category cannot be protected"
wantsub "and the message names it" "Unknown notification category: emergencz"
want "the database never saw any of those four" "$(db_audit 'NOTIFICATION_RETENTION_SET')" "$SET_AUDIT_BEFORE_REJECTS"
want "and the stored policy is still the last accepted one" \
  "$(dbq "select archive_after_days||'/'||coalesce(purge_after_days::text,'null') from estate_notification_retention_policies where estate_id='$ESTATE'")" "90/null"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"purge_after_days":0}' "0 is the wire spelling of never-purge"
want_empty "and it reads back as absent" "$(jget "$W/resp-bff.json" purge_after_days)" "$(jget "$W/resp-bff.json" archive_after_days)"
want "stored as NULL, not as 0" \
  "$(dbq "select coalesce(purge_after_days::text,'null') from estate_notification_retention_policies where estate_id='$ESTATE'")" "null"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":2,"purge_after_days":null}' "shorten the horizon so the sweep has something to do"
want "the horizon moved" "$(jget "$W/resp-bff.json" archive_after_days)" "2"
want "every accepted write is audited under the estate" \
  "$(dbq "select count(*) from estate_audit_log where estate_id='$ESTATE' and action='NOTIFICATION_RETENTION_SET' and subject_type='estate'")" "$(db_audit 'NOTIFICATION_RETENTION_SET')"
want "and the audit counts grew by exactly the accepted writes (four before the rejects, two after)" \
  "$(db_audit 'NOTIFICATION_RETENTION_SET')" "$((SET_AUDIT_BEFORE + 6))"

note "--- 16. the sweep archives what is eligible and nothing else"
# read-all had stamped row 05; put it back to unread so the "a schedule never archives what nobody has read"
# exemption is tested against a row that is genuinely unread when the sweep runs.
dbq "UPDATE estate_notifications SET read_at = NULL WHERE id='$N05'" >/dev/null
KEEP="'security','system'"
ELIGIBLE=$(db_archive_eligible 2 "$KEEP")
ELIGIBLE_RES=$(db_archive_eligible_for "$RES" 2 "$KEEP")
verdict "the 2-day horizon left the sweep something eligible" "$([ "$ELIGIBLE" -gt 0 ] && echo 0 || echo 1)" "eligible=$ELIGIBLE (recipient-scoped: $ELIGIBLE_RES)"
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "run the estate's schedule now"
want "estate scope comes from the caller" "$(jget "$W/resp-bff.json" estate_id)" "$ESTATE"
want "the sweep archived exactly what the database said was eligible" "$(jget "$W/resp-bff.json" notifications_archived)" "$ELIGIBLE"
want "and purged nothing, because the policy never opted in" "$(jget "$W/resp-bff.json" notifications_purged)" "0"
want "the pinned row stayed in the inbox" "$(db_flag "$N01" "archived_at is null")" "t"
want "the unread row stayed in the inbox" "$(db_flag "$N05" "archived_at is null")" "t"
want "the protected security row was not archived although it is 200 days old" "$(db_flag "$N03" "archived_at is null")" "t"
want "the newest row is nowhere near the horizon" "$(db_flag "$N08" "archived_at is null")" "t"
want "the admin's eligible copy moved (the sweep is estate-wide, not per recipient)" "$(db_flag "$N21" "archived_at is not null")" "t"
want "and the other estate's eligible row did not move" "$(db_flag "$OTHER" "archived_at is null")" "t"
want "nothing eligible was left behind" "$(db_archive_eligible 2 "$KEEP")" "0"
want "the recipient's archived half grew by exactly their share" \
  "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null")" "$((ARCHIVED+ELIGIBLE_RES))"
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "pressing it again is safe"
want "archived 0 the second time" "$(jget "$W/resp-bff.json" notifications_archived)" "0"
want "purged 0 the second time" "$(jget "$W/resp-bff.json" notifications_purged)" "0"
want "and both runs were audited" "$(db_audit 'NOTIFICATION_RETENTION_RUN')" "2"
want "the first audit row carries the counters" \
  "$(dbq "select metadata->>'notifications_archived' from estate_audit_log where estate_id='$ESTATE' and action='NOTIFICATION_RETENTION_RUN' order by created_at limit 1")" "$ELIGIBLE"
call inboxres GET "/api/v1/estate/notifications?state=archived&limit=200"
want "the archived view now holds what the sweep moved" "$(jget "$W/resp-bff.json" total)" "$((ARCHIVED+ELIGIBLE_RES))"

note "--- 17. purge is opt-in, and the guard is a database rule, not a courtesy"
expect 400 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":2,"purge_after_days":1}' "purging before the archive horizon is refused"
wantsub "by the same rule" "Retention days must be positive and purge cannot be scheduled before archive"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":2,"purge_after_days":30}' "purge after it is accepted"
want "read back" "$(jget "$W/resp-bff.json" purge_after_days)" "30"
# 30 days would sweep nothing the lane needs to *see* swept, so the horizon is set to 3 days in SQL. That is
# the documented fixture movement, not a way around the API: the purge path is the database's either way.
dbq "UPDATE estate_notification_retention_policies SET purge_after_days=3 WHERE estate_id='$ESTATE'" >/dev/null
PURGE_ELIGIBLE=$(db_purge_eligible 3 "$KEEP")
verdict "two archived rows sit past a 3-day horizon" "$([ "$PURGE_ELIGIBLE" = 2 ] && echo 0 || echo 1)" "eligible=$PURGE_ELIGIBLE (11 and 14; 12 is pinned, 13 is protected by category)"
# Sampled immediately before the run, not back at the last sweep: the bulk fixtures are one minute apart and
# straddle the 2-day horizon exactly, so a row crosses it every minute the lane takes to get here. "What the
# sweep moved" is only decidable against what was eligible at the instant it was asked.
ARCH_BEFORE_PURGE_RUN=$(db_archive_eligible 2 "$KEEP")
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "sweep with the opt-in horizon set"
want "purged exactly the archived rows past the horizon" "$(jget "$W/resp-bff.json" notifications_purged)" "$PURGE_ELIGIBLE"
want "and its archive counter is exactly the rows eligible at that instant" "$(jget "$W/resp-bff.json" notifications_archived)" "$ARCH_BEFORE_PURGE_RUN"
want "the plain archived row is gone" "$(db_row "$N11")" "0"
want "the archived unread row is gone too (purging does not care about read state)" "$(db_row "$N14")" "0"
want "the pinned archived row is still there" "$(db_row "$N12")" "1"
want "the protected archived row is still there" "$(db_row "$N13")" "1"
want "the other estate's row is still there" "$(db_row "$OTHER")" "1"
dbq "UPDATE estate_notifications SET archived_at = NOW() - make_interval(days => 100) WHERE id='$N07'" >/dev/null
# Put one row firmly on the ARCHIVE side of the horizon before the hold goes on: read, unpinned, an
# unprotected category, three days old against the policy's two-day window. Without a deliberate case the
# hold proves nothing about archiving — the first run of this file found a bulk row had drifted past the
# horizon on its own, so "0 archived" was a clock artifact rather than a designed outcome, and the assertion
# written against it failed.
dbq "UPDATE estate_notifications SET read_at = NOW(), created_at = NOW() - make_interval(days => 3) WHERE id='$N08'" >/dev/null
dbq "UPDATE estates SET legal_hold = TRUE, legal_hold_reason = 'Phase 2.5a BFF lane' WHERE id='$ESTATE'" >/dev/null
HOLD_ELIGIBLE=$(db_purge_eligible 3 "$KEEP")
HOLD_ARCHIVE_ELIGIBLE=$(db_archive_eligible 2 "$KEEP")
verdict "the deliberate row is archive-eligible while the estate is held" \
  "$([ "$HOLD_ARCHIVE_ELIGIBLE" -ge 1 ] && echo 0 || echo 1)" "eligible=$HOLD_ARCHIVE_ELIGIBLE (row 08: three days old, 2-day horizon)"
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "a held estate still answers the run"
want "it archived nothing" "$(jget "$W/resp-bff.json" notifications_archived)" "0"
want "and purged nothing" "$(jget "$W/resp-bff.json" notifications_purged)" "0"
want "even though the schedule had a row past the horizon" "$([ "$HOLD_ELIGIBLE" -gt 0 ] && echo "held-but-eligible" || echo "none-eligible")" "held-but-eligible"
want "and the row the hold protects is still there" "$(db_row "$N07")" "1"
# estate_notifications_apply_retention returns early on `skipped = 'legal_hold'` — it does not archive and
# then refuse to purge. That is what makes a hold an order to keep evidence rather than a partial sweep.
want "the hold stops archiving as well as purging" "$(db_flag "$N08" "archived_at is null")" "t"
dbq "UPDATE estates SET legal_hold = FALSE, legal_hold_reason = NULL WHERE id='$ESTATE'" >/dev/null
POST_HOLD_ELIGIBLE=$(db_purge_eligible 3 "$KEEP")
POST_HOLD_ARCHIVE=$(db_archive_eligible 2 "$KEEP")
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "clearing the hold re-opens the schedule"
want "which now purges what the hold kept" "$(jget "$W/resp-bff.json" notifications_purged)" "$POST_HOLD_ELIGIBLE"
verdict "and archives at least what the hold had kept unarchived" \
  "$([ "$(jget "$W/resp-bff.json" notifications_archived)" -ge "$POST_HOLD_ARCHIVE" ] && echo 0 || echo 1)" \
  "archived=$(jget "$W/resp-bff.json" notifications_archived) eligible_at_ask=$POST_HOLD_ARCHIVE"
want "the row the hold was covering is archived now" "$(db_flag "$N08" "archived_at is not null")" "t"
want "and the row is gone" "$(db_row "$N07")" "0"
want "the pinned row still refuses" "$(db_row "$N12")" "1"
want "the protected row still refuses" "$(db_row "$N13")" "1"
# The guard has no override, so it blocks the lane's own housekeeping too. Proving it ALLOWS a plain archived
# row is what makes "refused" evidence rather than an artifact of a blanket block.
GUARD_MSG=$(psqlx -Atc "DELETE FROM estate_notifications WHERE id='$N12'" 2>&1 | tr -d '\r' | head -2)
verdict "a direct DELETE of the pinned row is refused by name" \
  "$(printf '%s' "$GUARD_MSG" | grep -qi 'because it is pinned' && echo 0 || echo 1)" "${GUARD_MSG:-no error raised}"
GUARD_MSG2=$(psqlx -Atc "DELETE FROM estate_notifications WHERE id='$N13'" 2>&1 | tr -d '\r' | head -2)
verdict "a direct DELETE of the protected row names its category" \
  "$(printf '%s' "$GUARD_MSG2" | grep -qi 'because its category security is protected' && echo 0 || echo 1)" "${GUARD_MSG2:-no error raised}"
want "neither refusal deleted anything" "$(dbq "select count(*) from estate_notifications where id in ('$N12','$N13')")" "2"
SACRIFICE=$(dbq "select id from estate_notifications where estate_id='$ESTATE' and archived_at is not null
                  and not pinned and category <> ALL (ARRAY[$KEEP]) limit 1")
if [ -z "$SACRIFICE" ]; then note "FAIL no sacrificial archived row to delete — the guard's permission is unproven"; FAIL=$((FAIL+1)); else
  # `psql -Atc … RETURNING id` prints the row and then the command tag on its own line ("DELETE 1"), so the
  # id is the first line — comparing the whole output to the id once reported a successful delete as a failure.
  DEL_OUT=$(psqlx -Atc "DELETE FROM estate_notifications WHERE id='$SACRIFICE' AND archived_at IS NOT NULL AND NOT pinned RETURNING id" 2>&1 | tr -d '\r' | grep -v '^DELETE ' | head -1)
  verdict "a plain archived row IS deletable (the guard is not a blanket block)" \
    "$([ "$DEL_OUT" = "$SACRIFICE" ] && echo 0 || echo 1)" "deleted=${DEL_OUT:-nothing}"
  want "and the row really is gone" "$(db_row "$SACRIFICE")" "0"
fi
want "the pinned and protected rows are still present after that" \
  "$(dbq "select count(*) from estate_notifications where id in ('$N12','$N13')")" "2"

note "--- 18. the sweep never reaches a second estate, from either direction"
want "the other estate's row is still unarchived" "$(db_flag "$OTHER" "archived_at is null")" "t"
want "and is still its estate's only row" "$(dbq "select count(*) from estate_notifications where estate_id='$OTHER_ESTATE'")" "1"
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "one more sweep of the caller's estate"
want "the other estate's row still has no archive stamp" "$(db_flag "$OTHER" "archived_at is null")" "t"
want "and still no rows were purged from it" "$(dbq "select count(*) from estate_notifications where estate_id='$OTHER_ESTATE'")" "1"
call inboxres GET "/api/v1/estate/notifications?state=all&limit=200"
want "every row the inbox answers belongs to the caller's estate" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.every(n=>n.estateId===process.argv[2]))' "$W/resp-bff.json" "$ESTATE")" "true"
want "and none of them is the other estate's row" \
  "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.data.some(n=>n.id===process.argv[2]))' "$W/resp-bff.json" "$OTHER")" "false"

note "--- 19. the defaults an estate that never wrote a policy gets"
# The lane estate has a policy row by now, so `defaulted` is proven by removing it and reading the answer the
# sweep would apply — then writing it back over HTTP, so the lane leaves the row its audit trail refers to.
POLICY_SNAPSHOT=$(dbq "select enabled||'|'||archive_after_days||'|'||coalesce(purge_after_days::text,'null')||'|'||array_to_string(keep_categories,',') from estate_notification_retention_policies where estate_id='$ESTATE'")
# Row 05 is the unread exemption from section 16; make it read so the *default* 90-day horizon has something
# to act on, which is what proves the function applies 90 and not "nothing, ever" when no row exists.
dbq "UPDATE estate_notifications SET read_at = NOW() - make_interval(days => 100) WHERE id='$N05'" >/dev/null
DEFAULT_ELIGIBLE=$(db_archive_eligible 90 "'security','system'")
dbq "DELETE FROM estate_notification_retention_policies WHERE estate_id='$ESTATE'" >/dev/null
expect 200 inboxadmin GET "/api/v1/estate/notifications/retention" "the admin reads a schedule for an estate that has none"
want "defaulted is true" "$(jget "$W/resp-bff.json" defaulted)" "true"
want "the documented archive horizon" "$(jget "$W/resp-bff.json" archive_after_days)" "90"
want_empty "the default has no purge horizon" "$(jget "$W/resp-bff.json" purge_after_days)" "$(jget "$W/resp-bff.json" archive_after_days)"
want "the documented keep list" "$(jget "$W/resp-bff.json" keep_categories)" "security,system"
want "enabled by default" "$(jget "$W/resp-bff.json" enabled)" "true"
want_empty "nobody updated a default" "$(jget "$W/resp-bff.json" updated_by)" "$(jget "$W/resp-bff.json" estate_id)"
want_empty "and there is no updated_at" "$(jget "$W/resp-bff.json" updated_at)" "$(jget "$W/resp-bff.json" estate_id)"
expect 200 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "the sweep runs with no policy row at all"
want "and applies the documented 90-day default rather than archiving nothing" "$(jget "$W/resp-bff.json" notifications_archived)" "$DEFAULT_ELIGIBLE"
want "the row it moved is the one that was unread and is now read" "$(db_flag "$N05" "archived_at is not null")" "t"
want "a default never purges" "$(jget "$W/resp-bff.json" notifications_purged)" "0"
want "and the pinned row survived a default sweep too" "$(db_flag "$N01" "archived_at is null")" "t"
expect 200 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":2,"purge_after_days":3,"keep_categories":["security","system"],"enabled":true}' "writing over a default creates the row"
want "defaulted is false again" "$(jget "$W/resp-bff.json" defaulted)" "false"
want "and the values are the ones the lane had" \
  "$(dbq "select enabled||'|'||archive_after_days||'|'||coalesce(purge_after_days::text,'null')||'|'||array_to_string(keep_categories,',') from estate_notification_retention_policies where estate_id='$ESTATE'")" "$POLICY_SNAPSHOT"

note "--- 20. suspension and closure keep the history readable and stop the writes"
LANE_ROWS=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE'")
FINAL_ROWS=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")
dbq "UPDATE estates SET status='suspended' WHERE id='$ESTATE'" >/dev/null
expect 200 inboxres GET "/api/v1/estate/notifications?state=all&limit=200" "a suspended estate's member still reads their history"
want "with the rows they had" "$(jget "$W/resp-bff.json" total)" "$FINAL_ROWS"
expect 423 inboxres POST "/api/v1/estate/notifications/$N01/archive" '{"archived":true}' "a suspended estate takes no archive"
wantsub "and the message says suspended" "Estate is suspended"
expect 423 inboxadmin PUT "/api/v1/estate/notifications/retention" '{"archive_after_days":90}' "a suspended estate takes no schedule write"
expect 423 inboxadmin POST "/api/v1/estate/notifications/retention/run" '{}' "a suspended estate takes no sweep"
want "no row moved while suspended" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE'")" "$LANE_ROWS"
dbq "UPDATE estates SET status='closed' WHERE id='$ESTATE'" >/dev/null
expect 200 inboxres GET "/api/v1/estate/notifications?state=all&limit=200" "a closed estate still answers the read"
want "and nothing was deleted on the way" "$(jget "$W/resp-bff.json" total)" "$FINAL_ROWS"
expect 423 inboxres POST "/api/v1/estate/notifications/$N01/read" '{}' "a closed estate takes no read stamp"
wantsub "by the same gate" "Estate is closed"
want "the closed estate's schedule row is still there for the audit trail" \
  "$(dbq "select count(*) from estate_notification_retention_policies where estate_id='$ESTATE'")" "1"
want "the pinned fixture and the protected fixture both survived the lane" \
  "$(dbq "select count(*) from estate_notifications where id in ('$N12','$N13')")" "2"
want "the other estate survived it all" "$(dbq "select count(*) from estate_notifications where id='$OTHER'")" "1"
want "the lane wrote both kinds of audit row" \
  "$(dbq "select count(distinct action) from estate_audit_log where estate_id='$ESTATE' and action like 'NOTIFICATION_RETENTION%'")" "2"

LINES_PASS=$(grep -c '^PASS' "$OUT"); LINES_FAIL=$(grep -c '^FAIL' "$OUT")
if [ "$PASS" != "$LINES_PASS" ] || [ "$FAIL" != "$LINES_FAIL" ]; then
  note "COUNTER DRIFT: tally says PASS=$PASS FAIL=$FAIL, the transcript holds $LINES_PASS/$LINES_FAIL lines"
  FAIL=$((FAIL+1))
fi
note "=== Phase 2.5a BFF lane summary: PASS=$PASS FAIL=$FAIL estate=$ESTATE (transcript lines $LINES_PASS/$LINES_FAIL)"
[ "$FAIL" = 0 ]
