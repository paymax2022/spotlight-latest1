#!/usr/bin/env bash
# API_LIVE probe — estate inbox archive, search, pin and notification retention
# (Phase 2.5a, estate-d M18: EST-UAT-0359, defect ESTD-D008).
#
# Drives the Go backend on :8095 (see 05-run-server.sh) with FEATURE_ESTATE_LIFECYCLE_ENABLED and
# FEATURE_ESTATE_VERIFICATION_REQUIRED on, so the review queue is reachable (a lane inbox needs an *active*
# estate before any write succeeds) and legal hold is set over HTTP rather than by hand.
#
# The counts are read out of the database immediately before each assertion rather than hardcoded, so a
# re-run against a leftover lane still compares the API's answer with the true row set — and every
# "survived" assertion is a row the API did NOT touch, which a hardcoded number cannot show.
#
# Run from anywhere:  bash docs/qa/estate-uat-443/live-2026-10-28/06-probe-notifications.sh
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8095}"
W=/tmp/estate-uat-live
T="$W/tokens"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$DIR/../../../.." && pwd)}"
OUT="${OUT:-$DIR/probe-notifications-phase2.5a.out}"
: > "$OUT"

PASS=0; FAIL=0
# -i matters: without it `docker exec` closes stdin and a `-f -` script (the seed) runs zero statements and
# still exits 0 — the first run of this lane "applied" its seed that way and asserted against an empty inbox.
psqlx() { docker exec -i supabase_db_spotlight psql -U postgres -d postgres "$@"; }
jwt() { cat "$T/$1.jwt" 2>/dev/null; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }
dbq() { psqlx -Atc "$1" 2>/dev/null | tr -d '\r\n'; }

jget() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log("");process.exit(0)}const p=process.argv[2].split(".");let v=j;for(const k of p){if(v==null)break;v=v[k]}if(Array.isArray(v)){console.log(v.join(","));process.exit(0)}console.log(v==null||v===undefined?"":v)' "$1" "$2" | tr -d '\r'; }
jlen() { node -e 'const fs=require("fs");let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){console.log(0);process.exit(0)}const p=process.argv[2].split(".").filter(x=>x!=="");let v=j;for(const k of p){if(v==null)break;v=v[k]}console.log(Array.isArray(v)?v.length:(v==null?0:1))' "$1" "$2"; }

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

expect() { # expect <want_code> <who> <METHOD> <path> [body] <description>
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  local msg; msg=$(jget "$W/resp.json" error)
  printf '%-4s want=%s got=%s  [%s as %s] %s\n' \
    "$( [ "$CODE" = "$want" ] && echo PASS || echo FAIL )" "$want" "$CODE" "$desc" "$who" "${msg:+— $msg}" | tee -a "$OUT"
  if [ "$CODE" = "$want" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

want() { # want <description> <got> <want>
  local ok=PASS
  # An empty got matching an empty want is not evidence — it is a lookup that returned nothing. Fail it,
  # so a missing fixture shows up as a failure instead of a quiet pass.
  if [ "$2" = "$3" ]; then [ -z "$2" ] && ok=EMPTY; else ok=FAIL; fi
  printf '%-4s %s — got "%s" want "%s"\n' "$([ "$ok" = PASS ] && echo PASS || echo FAIL )" "$1" "$2" "$3" | tee -a "$OUT"
  case "$ok" in PASS) PASS=$((PASS+1));; *) FAIL=$((FAIL+1));; esac
  [ "$ok" = EMPTY ] && note "  ^ both sides empty: the value was never read"
  return 0
}

wantsub() { # wantsub <description> <pattern>
  local ok=PASS; grep -q -- "$2" "$W/resp.json" || ok=FAIL
  printf '%-4s %s — body %s "%s"\n' "$ok" "$1" "$( [ "$ok" = PASS ] && echo contains || echo MISSING )" "$2" | tee -a "$OUT"
  if [ "$ok" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

note() { printf '%s\n' "$*" | tee -a "$OUT"; }

# verdict <description> <ok:0|1> <detail> — for the checks that are not HTTP calls but still have to reach
# the same counters. Written as a function rather than an inline `$(case …)`: command substitution runs in a
# subshell, so on the first green run three guard assertions printed PASS into the transcript while the
# summary line reported three fewer than the file actually contained.
verdict() {
  printf '%-4s %s — %s\n' "$( [ "$2" = 0 ] && echo PASS || echo FAIL )" "$1" "$3" | tee -a "$OUT"
  if [ "$2" = 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

# want_empty <description> <got> <proof-the-document-parsed>
# Some assertions are about a key being *absent* (a default policy has no purge horizon, an un-archived row
# has no archive stamp). `want` cannot carry those: empty-vs-empty is exactly the vacuous pass it was built
# to reject. So the caller must hand in a sibling value that has to be present for the same reason the
# absent one is, and an empty got only counts if that sibling really arrived.
want_empty() {
  if [ -z "$3" ]; then
    want "$1 (guard value missing — the response never parsed)" "absent" "present"
    return 0
  fi
  want "$1" "${2:-absent}" "absent"
}

# epoch <ISO-8601, with any offset> -> unix seconds. The Go surface marshals timestamps in the server's own
# zone ("2026-07-20T08:56:57.868375+01:00" on this box, because it runs at UTC+1) while psql prints +00, so
# a string comparison of an archive stamp would fail on two identical instants. Compare the instant instead.
epoch() { node -e 'const t=Date.parse(process.argv[1]);console.log(Number.isNaN(t)?"":Math.floor(t/1000))' "$1" | tr -d '\r'; }

# nid <exact title> -> the row id
nid() { dbq "select id from estate_notifications where estate_id='$ESTATE' and title='$1' limit 1"; }
# db_state <user> -> '<active count> <archived count> <all count>' for one recipient
db_state() {
  local u=$1
  printf '%s %s %s' \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u' and archived_at is null")" \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u' and archived_at is not null")" \
    "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$u'")"
}
# db_archive_eligible <days> <quoted keep list> -> rows a sweep would archive now (estate-wide, all recipients)
db_archive_eligible() {
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and archived_at is null
         and read_at is not null and not pinned and category <> ALL (ARRAY[$2])
         and created_at < NOW() - make_interval(days => $1)"
}
db_purge_eligible() {
  dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and archived_at is not null
         and not pinned and category <> ALL (ARRAY[$2]) and archived_at < NOW() - make_interval(days => $1)"
}
db_row() { dbq "select count(*) from estate_notifications where id='$1'"; }

ADMIN=$(uid admin); RES=$(uid resident); GUARD=$(uid guard); NOBODY=$(uid nobody)
STAMP=$(date -u +%Y%m%d%H%M%S)
ANON_KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2- | tr -d '\r')

note "=== estate notification inbox / retention API_LIVE probe @ $(date -u +%Y-%m-%dT%H:%M:%SZ) base=$BASE"
note "admin=$ADMIN resident=$RES guard=$GUARD outsider=$NOBODY run-id=$STAMP"

note "--- 1. the lane estate, created over HTTP, and the notification routes on a pending estate"
expect 201 admin POST "/api/finance/estate" \
  "{\"name\":\"UAT Inbox Estate $STAMP\",\"address\":\"41 Inbox Crescent, Ikate, Lekki, Lagos\"}" \
  "create the lane estate (verification required -> pending)"
ESTATE=$(jget "$W/resp.json" id)
[ -z "$ESTATE" ] && { printf 'ABORT no estate id (dev backend unreachable?) got=%s\n' "$CODE" | tee -a "$OUT"; exit 90; }
note "lane estate=$ESTATE status=$(jget "$W/resp.json" status)"
want "estate created pending" "$(jget "$W/resp.json" status)" "pending"

expect 401 "" GET "/api/finance/estate/$ESTATE/notifications" "no token at all"
expect 403 resident GET "/api/finance/estate/$ESTATE/notifications" "not a member of the lane estate yet"
expect 200 admin GET "/api/finance/estate/$ESTATE/notifications" "creator (estate_admin) reads the empty inbox: reads stay open"
want "pending inbox read answers the paging envelope" "$(jget "$W/resp.json" state)" "active"
want "pending inbox total" "$(jget "$W/resp.json" total)" "0"
expect 200 admin GET "/api/finance/estate/$ESTATE/notifications/retention" "creator reads the retention schedule while pending"
want "absent policy answers the documented default window" "$(jget "$W/resp.json" archive_after_days)" "90"
want "and says it is a default, not a decision" "$(jget "$W/resp.json" defaulted)" "true"
expect 403 resident GET "/api/finance/estate/$ESTATE/notifications/retention" "the schedule is admin-only, pending or not"
expect 423 admin POST "/api/finance/estate/$ESTATE/notifications/read-all" '{}' "pending estate refuses the inbox write"
wantsub "the refusal is the lifecycle code, not a membership error" 'ESTATE_NOT_ACTIVE'
wantsub "and names the estate status" '"estate_status":"pending"'
expect 423 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":30}' "pending estate refuses a retention change"
expect 423 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "pending estate cannot run a sweep"

note "--- 2. publish the estate through the platform review queue"
expect 403 resident GET "/api/finance/estate-admin/estates?status=pending" "the queue is RBAC-gated"
expect 200 admin GET "/api/finance/estate-admin/estates?status=pending" "reviewer lists the pending queue"
wantsub "the lane estate is in its own review queue" "$ESTATE"
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/lifecycle" \
  '{"action":"verify","reason":"Phase 2.5a lane: publish the inbox estate"}' "verify publishes it"
want "estate now active" "$(jget "$W/resp.json" status)" "active"
expect 200 admin GET "/api/finance/estate/$ESTATE/notifications" "reads still fine once active"

note "--- 3. seed the fixtures (memberships + a 67-row inbox at chosen ages/states)"
psqlx -v ON_ERROR_STOP=1 -v estate="$ESTATE" -v res="$RES" -v guard="$GUARD" -f - \
  < "$DIR/04-seed-notifications.sql" >> "$OUT" 2>&1 \
  && note "seed applied" || { note "ABORT seed failed"; exit 90; }
set -- $(db_state "$RES"); RES_ACTIVE=$1; RES_ARCH=$2; RES_ALL=$3
set -- $(db_state "$GUARD"); GUARD_ACTIVE=$1; GUARD_ARCH=$2; GUARD_ALL=$3
note "resident inbox: active=$RES_ACTIVE archived=$RES_ARCH all=$RES_ALL — guard: active=$GUARD_ACTIVE archived=$GUARD_ARCH"
want "archived + active partitions the inbox" "$((RES_ACTIVE + RES_ARCH))" "$RES_ALL"

N01=$(nid 'UAT25a 01 pinned twenty'); N02=$(nid 'UAT25a 02 old general read')
N03=$(nid 'UAT25a 03 old security read'); N05=$(nid 'UAT25a 05 old general unread')
N06=$(nid 'UAT25a 06 kairos body'); N07=$(nid 'UAT25a 07 mid maintenance')
N08=$(nid 'UAT25a 08 newest general'); N11=$(nid 'UAT25a 11 archived old general')
N12=$(nid 'UAT25a 12 archived pinned'); N13=$(nid 'UAT25a 13 archived security')
N14=$(nid 'UAT25a 14 archived unread'); N15=$(nid 'UAT25a 15 sacrificial')
N21=$(nid 'UAT25a 21 guard copy')
note "fixture ids: 01=$N01 02=$N02 05=$N05 07=$N07 08=$N08 12=$N12 15=$N15 21=$N21"

KEEP="'security','system'"

note "--- 4. the paging envelope: total is the number the old LIMIT 50 hid"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications" "default inbox read"
want "default limit is 50" "$(jget "$W/resp.json" limit)" "50"
want "total reports the whole match set, not the page" "$(jget "$W/resp.json" total)" "$RES_ACTIVE"
want "the page itself is capped at the limit" "$(jlen "$W/resp.json" data)" "50"
want "first item is the pinned row, above a 200-day age" "$(jget "$W/resp.json" data.0.title)" "UAT25a 01 pinned twenty"
want "second item is the newest unpinned row" "$(jget "$W/resp.json" data.1.title)" "UAT25a 08 newest general"
want "third is the newest bulk row" "$(jget "$W/resp.json" data.2.title)" "UAT25a bulk 55"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?limit=2&offset=4" "a two-row window at offset 4"
want "window length honoured" "$(jlen "$W/resp.json" data)" "2"
want "total unchanged by paging" "$(jget "$W/resp.json" total)" "$RES_ACTIVE"
want "offset echoed" "$(jget "$W/resp.json" offset)" "4"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?limit=50&offset=60" "walk past the end of the old silent cap"
want "the tail row count is total minus offset" "$(jlen "$W/resp.json" data)" "$((RES_ACTIVE - 60))"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?limit=0" "limit=0 is 'no preference', not 'nothing'"
want "limit falls back to the default" "$(jget "$W/resp.json" limit)" "50"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?limit=abc" "a non-numeric limit is the same request as none"
want "malformed limit -> default 50" "$(jget "$W/resp.json" limit)" "50"
expect 400 resident GET "/api/finance/estate/$ESTATE/notifications?limit=201" "limit above 200 refused"
expect 400 resident GET "/api/finance/estate/$ESTATE/notifications?state=bogus" "unknown state refused, not silently treated as active"
expect 400 resident GET "/api/finance/estate/$ESTATE/notifications?category=emergencz" "a category outside the domain refused (a typo must not silently filter everything out)"

note "--- 5. the two halves of the inbox, and the filters"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?state=archived" "archive view"
want "archive view total" "$(jget "$W/resp.json" total)" "$RES_ARCH"
want "the archive view leads with the pinned archived row (pinned-first holds in both halves)" "$(jget "$W/resp.json" data.0.title)" "UAT25a 12 archived pinned"
want "and carries the stamp the database holds (compared as an instant: Go prints it at +01:00, psql at +00)" \
  "$(epoch "$(jget "$W/resp.json" data.0.archived_at)")" \
  "$(dbq "select floor(extract(epoch from archived_at))::bigint from estate_notifications where id='$N12'")"
want "second is the newest un-pinned archived row by created_at" "$(jget "$W/resp.json" data.1.title)" "UAT25a 11 archived old general"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?state=all" "both halves in one read"
want "all = active + archived" "$(jget "$W/resp.json" total)" "$RES_ALL"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?category=security" "category filter"
want "one security row in the active half" "$(jget "$W/resp.json" total)" "1"
want "and it is the fixture" "$(jget "$W/resp.json" data.0.title)" "UAT25a 03 old security read"
UNREAD=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null and read_at is null")
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?unread_only=true" "unread-only view"
want "unread-only total matches the database" "$(jget "$W/resp.json" total)" "$UNREAD"
want "unread_only echoed in the envelope" "$(jget "$W/resp.json" unread_only)" "true"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?q=Kairos" "search reaches the body, not only the title"
want "the Kairos row is found" "$(jget "$W/resp.json" data.0.title)" "UAT25a 06 kairos body"
want "search total" "$(jget "$W/resp.json" total)" "1"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?q=maintenance" "search reaches the title"
want "title match total" "$(jget "$W/resp.json" total)" "1"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?q=bulk%204" "search matches the padded bulk labels"
want "a search page still reports the whole match count (bulk 40-49)" "$(jget "$W/resp.json" total)" "10"
expect 400 resident GET "/api/finance/estate/$ESTATE/notifications?q=k" "a one-character term is refused rather than matching half the inbox"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?q=UAT25a%2011%20archived%20old" "search sees the archived half too, once asked"
want "searched into the archive" "$(jget "$W/resp.json" total)" "0"
note "  ^ with state=active (the default) an archived row is not findable; state=all is the documented way back to it:"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?state=all&q=UAT25a%2011%20archived%20old" "search across both halves"
want "the archived row is reachable by search" "$(jget "$W/resp.json" total)" "1"
expect 400 resident GET "/api/finance/estate/$ESTATE/notifications?q=%25" "a bare wildcard is refused by the same 2-character floor, not run as match-everything"
wantsub "the refusal says why" "at least 2 characters"
note "  ^ an earlier draft of this lane claimed Go would accept %% and widen the match; it does not — ErrInvalidNotificationQuery fires on length before the term is escaped. The ILIKE is still parameter-bound (see the a(b case below), so the floor is a usability guard, not the injection defence."
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?q=a(b" "a bracketed term is literal in Go (PostgREST would reject it — see the BFF lane)"
want "literal-bracket search answers 200" "$(jget "$W/resp.json" total)" "0"

note "--- 6. marking one notice read, and the stamp's immutability"
READ_BEFORE=$(dbq "select coalesce(read_at::text,'null') from estate_notifications where id='$N08'")
want "fixture 08 starts unread" "$READ_BEFORE" "null"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N08/read" '{}' "mark unread row read"
want "the response carries the stamp" "$(jget "$W/resp.json" read_at | cut -c1-4)" "$(date -u +%Y)"
STAMP1=$(dbq "select read_at::text from estate_notifications where id='$N08'")
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N08/read" '{}' "mark it read a second time"
want "the second call did not move the stamp (it is evidence of when it was seen)" "$(dbq "select read_at::text from estate_notifications where id='$N08'")" "$STAMP1"
expect 404 resident POST "/api/finance/estate/$ESTATE/notifications/$N21/read" '{}' "another recipient's row is 404, not 403 — no inbox existence leak"
expect 400 resident POST "/api/finance/estate/$ESTATE/notifications/not-a-uuid/read" '{}' "malformed notification id"
expect 400 resident POST "/api/finance/estate/not-a-uuid/notifications/$N08/read" '{}' "malformed estate id"
expect 404 nobody POST "/api/finance/estate/$ESTATE/notifications/$N08/read" '{}' "a non-member cannot stamp anyone's inbox"
wantsub "and the refusal says it is not their row, so a stranger learns no more than a member would" "no such notification in your inbox"
note "  ^ by design, not by omission: single-row writes are scoped by (id, estate_id, user_id) in notifOwnRow, so the only write a caller can ever make is to their own copy. The estate-wide write (read-all) does assert membership and answers 403 - see section 11. The BFF reaches the opposite order (it resolves the estate first and answers 403 to a stranger); the divergence is recorded in the README rather than papered over."

note "--- 7. the archive round trip is reversible and touches nothing else"
set -- $(db_state "$RES"); BEFORE_ACTIVE=$1; BEFORE_ARCH=$2
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N07/archive" '{}' "archive with an empty body means archive"
want "the row came back stamped" "$(jget "$W/resp.json" archived_at | cut -c1-4)" "$(date -u +%Y)"
want "the title survived" "$(jget "$W/resp.json" title)" "UAT25a 07 mid maintenance"
want "the deep link survived" "$(jget "$W/resp.json" deep_link)" "estate://maintenance/77"
want "the read state survived (same instant, whatever zone each side prints it in)" "$(epoch "$(jget "$W/resp.json" read_at)")" \
  "$(dbq "select floor(extract(epoch from read_at))::bigint from estate_notifications where id='$N07'")"
set -- $(db_state "$RES")
want "active half shrank by one" "$1" "$((BEFORE_ACTIVE - 1))"
want "archived half grew by one" "$2" "$((BEFORE_ARCH + 1))"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N07/archive" '{"archived":false}' "un-archive is the way back"
want_empty "the stamp is gone" "$(jget "$W/resp.json" archived_at)" "$(jget "$W/resp.json" title)"
want "and the row is not deleted" "$(db_row "$N07")" "1"
set -- $(db_state "$RES")
want "counts back to the baseline" "$1 $2" "$BEFORE_ACTIVE $BEFORE_ARCH"
expect 404 resident POST "/api/finance/estate/$ESTATE/notifications/$N21/archive" '{}' "archiving is per recipient: the guard's copy is not the resident's to hide"
want "the guard's row is still in the guard's active inbox" "$(dbq "select count(*) from estate_notifications where id='$N21' and archived_at is null")" "1"
expect 404 nobody POST "/api/finance/estate/$ESTATE/notifications/$N07/archive" '{}' "non-member refused the same way the read route refuses"

note "--- 8. pinning: a personal flag, and an estate-admin retention decision"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N02/pin" '{"pinned":true}' "resident pins their own row"
want "pinned echoed true" "$(jget "$W/resp.json" pinned)" "true"
expect 400 resident POST "/api/finance/estate/$ESTATE/notifications/$N02/pin" '{}' "pin without the flag is a bad request, not a silent un-pin"
expect 403 resident POST "/api/finance/estate/$ESTATE/notifications/$N21/pin" "{\"pinned\":true,\"user_id\":\"$GUARD\"}" "a member naming another recipient is refused"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/$N21/pin" "{\"pinned\":true,\"user_id\":\"$GUARD\"}" "an estate admin may pin a recipient's copy — it is a retention decision"
want "the guard's row is pinned in the database" "$(dbq "select pinned from estate_notifications where id='$N21'")" "t"
expect 404 admin POST "/api/finance/estate/$ESTATE/notifications/7f7f7f7f-7f7f-7f7f-7f7f-7f7f7f7f7f7f/pin" "{\"pinned\":true,\"user_id\":\"$GUARD\"}" "an id that is not that recipient's row is 404"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/$N21/pin" "{\"pinned\":false,\"user_id\":\"$GUARD\"}" "and un-pin"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N02/pin" '{"pinned":false}' "un-pin the fixture row so the sweep sections see the shape they claim"
want "02 unpinned again" "$(dbq "select pinned from estate_notifications where id='$N02'")" "f"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications" "pinned-first ordering re-checked"
want "the pinned row still leads the page" "$(jget "$W/resp.json" data.0.title)" "UAT25a 01 pinned twenty"

note "--- 9. the retention schedule: who may read it, and what it will accept"
AUDIT_BEFORE=$(dbq "select count(*) from estate_audit_log where subject_id='$ESTATE' and action='NOTIFICATION_RETENTION_SET'")
expect 403 resident GET "/api/finance/estate/$ESTATE/notifications/retention" "the schedule is admin-only"
expect 200 admin GET "/api/finance/estate/$ESTATE/notifications/retention" "admin reads the effective policy"
want "absent row -> enabled by default" "$(jget "$W/resp.json" enabled)" "true"
want "archive window" "$(jget "$W/resp.json" archive_after_days)" "90"
want_empty "never purge by default" "$(jget "$W/resp.json" purge_after_days)" "$(jget "$W/resp.json" enabled)"
want "protected categories default" "$(jget "$W/resp.json" keep_categories)" "security,system"
want "and it is flagged as a default" "$(jget "$W/resp.json" defaulted)" "true"
want_empty "no author on a default" "$(jget "$W/resp.json" updated_by)" "$(jget "$W/resp.json" estate_id)"
expect 403 resident PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":30}' "a member cannot shorten the window"
expect 400 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":0}' "archive window must be positive"
expect 400 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":-5}' "negative refused"
expect 400 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"purge_after_days":10}' "purge inside the current 90-day archive window refused (the DB CHECK agrees)"
expect 400 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"keep_categories":["emergencz"]}' "a protected category outside the taxonomy refused — it would protect nothing"
expect 200 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"purge_after_days":0}' "purge 0 is the wire spelling of never"
want_empty "purge still absent after 0" "$(jget "$W/resp.json" purge_after_days)" "$(jget "$W/resp.json" archive_after_days)"
want "the policy is no longer a default" "$(jget "$W/resp.json" defaulted)" "false"
want "the author is the caller" "$(jget "$W/resp.json" updated_by)" "$ADMIN"
expect 200 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"keep_categories":["payment"]}' "a keep list replaces, it does not merge"
want "protected list is exactly what was sent" "$(jget "$W/resp.json" keep_categories)" "payment"
expect 200 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":30,"keep_categories":["security","system"],"purge_after_days":0}' "set the sweep window"
want "archive window written" "$(jget "$W/resp.json" archive_after_days)" "30"
want "keep list restored" "$(jget "$W/resp.json" keep_categories)" "security,system"
AUDIT_AFTER=$(dbq "select count(*) from estate_audit_log where subject_id='$ESTATE' and action='NOTIFICATION_RETENTION_SET'")
want "every accepted policy write left exactly one audit row" "$((AUDIT_AFTER - AUDIT_BEFORE))" "3"
expect 400 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":"thirty"}' "a non-numeric window is a bad request, not a 500"

note "--- 10. the sweep archives what is eligible and nothing else"
ELIG=$(db_archive_eligible 30 "$KEEP")
NOTE_UNREAD=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and archived_at is null and read_at is null and created_at < NOW() - interval '30 days'")
note "eligible now=$ELIG (old + read + unpinned + unprotected), old-and-unread rows that must survive=$NOTE_UNREAD"
want "the fixture set does contain unread old rows to protect" "$NOTE_UNREAD" "1"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "run this estate's schedule"
want "archived counter equals the row set the database says is eligible" "$(jget "$W/resp.json" notifications_archived)" "$ELIG"
want "nothing purged while purge is never" "$(jget "$W/resp.json" notifications_purged)" "0"
want "02 was archived by the sweep" "$(dbq "select archived_at is not null from estate_notifications where id='$N02'")" "t"
want "03 (protected category) was NOT" "$(dbq "select archived_at is null from estate_notifications where id='$N03'")" "t"
want "01 (pinned) was NOT" "$(dbq "select archived_at is null from estate_notifications where id='$N01'")" "t"
want "05 (old but unread) was NOT" "$(dbq "select archived_at is null from estate_notifications where id='$N05'")" "t"
want "08 (read, one day old) was NOT" "$(dbq "select archived_at is null from estate_notifications where id='$N08'")" "t"
want "21 (the guard's copy, same estate) WAS — the sweep is estate-wide, not per recipient" "$(dbq "select archived_at is not null from estate_notifications where id='$N21'")" "t"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "run it again in the same window"
want "idempotent: nothing new archived" "$(jget "$W/resp.json" notifications_archived)" "0"
expect 403 resident POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "a member cannot trigger the sweep"

note "--- 11. read-all stops at the edge of the archive"
UNREAD_ACTIVE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null and read_at is null")
ARCH_BEFORE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null")
want "14 is archived and unread before read-all" "$(dbq "select (archived_at is not null and read_at is null) from estate_notifications where id='$N14'")" "t"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/read-all" '{}' "mark the inbox read"
want "marked_read equals the unread active rows" "$(jget "$W/resp.json" marked_read)" "$UNREAD_ACTIVE"
want "nothing unread is left in the active half" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is null and read_at is null")" "0"
want "the archived unread row is still unread — read-all did not reach into the archive" "$(dbq "select read_at is null from estate_notifications where id='$N14'")" "t"
want "the archive half was not even re-stamped: its row count is unchanged" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES' and archived_at is not null")" "$ARCH_BEFORE"
# The counterpart of the 404s in sections 6 and 7: with no row id to scope on, this write can only be
# authorised by membership, and a stranger hears 403 rather than the per-row "not your notice" answer.
expect 403 nobody POST "/api/finance/estate/$ESTATE/notifications/read-all" '{}' "a stranger cannot stamp an estate they do not belong to"

note "--- 12. purge is opt-in, and the guard is a database rule, not a courtesy"
# A plain DELETE straight from psql — the guard fires for every role and every path, including this one.
DEL15=$(psqlx -Atc "delete from estate_notifications where id='$N15' returning id" 2>&1 | tr -d '\r' | head -1)
want "an ordinary notice is deletable (the guard is not a blanket block)" "$DEL15" "$N15"
DEL12=$(psqlx -Atc "delete from estate_notifications where id='$N12'" 2>&1 | tr -d '\r' | head -1)
case "$DEL12" in *"because it is pinned"*) V=0;; *) V=1;; esac
verdict "a pinned row refuses DELETE from any path, and says so" "$V" "$DEL12"
want "the pinned row still exists" "$(db_row "$N12")" "1"
DEL13=$(psqlx -Atc "delete from estate_notifications where id='$N13'" 2>&1 | tr -d '\r' | head -1)
case "$DEL13" in *"because its category security is protected"*) V=0;; *) V=1;; esac
verdict "a protected-category row refuses DELETE, naming its category" "$V" "$DEL13"
want "the protected row still exists" "$(db_row "$N13")" "1"

expect 200 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":30,"purge_after_days":30,"keep_categories":["security","system"]}' "arm a purge horizon"
want "purge window written" "$(jget "$W/resp.json" purge_after_days)" "30"
# Second archive pass: rows that read-all just stamped and that the first sweep had to skip because unread.
ELIG2=$(db_archive_eligible 30 "$KEEP")
PURG=$(db_purge_eligible 30 "$KEEP")
note "second pass: archive-eligible=$ELIG2 purge-eligible=$PURG"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "run the armed schedule"
want "the rows read-all made readable are archived now that they have been seen" "$(jget "$W/resp.json" notifications_archived)" "$ELIG2"
want "05 (unread at the first sweep, read now) is archived" "$(dbq "select archived_at is not null from estate_notifications where id='$N05'")" "t"
want "purged counter equals the archived rows past the horizon" "$(jget "$W/resp.json" notifications_purged)" "$PURG"
want "11 (archived, plain) is gone" "$(db_row "$N11")" "0"
want "14 (archived, never read) is gone — purge keys on the archive stamp, and only a recipient action puts an unread row there" "$(db_row "$N14")" "0"
want "12 (archived + pinned) survived the purge" "$(db_row "$N12")" "1"
want "13 (archived + protected) survived the purge" "$(db_row "$N13")" "1"
want "01 (pinned, active) survived" "$(db_row "$N01")" "1"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "run once more after the purge"
want "purged 0 — nothing new is past the horizon" "$(jget "$W/resp.json" notifications_purged)" "0"

note "--- 13. legal hold freezes the purge, not the person"
expect 403 resident POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "a member cannot sweep to test the hold"
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/legal-hold" \
  '{"enabled":true,"reason":"Phase 2.5a: hold the lane estate across the purge rehearsal"}' "put the estate under legal hold"
want "estate reports held" "$(dbq "select legal_hold from estates where id='$ESTATE'")" "t"
# Scoped to the recipient's own rows: every lifecycle transition the lane performs (verify, suspend,
# reactivate, close) writes its own 'system' notification into the estate for the owner, so an estate-wide
# count grows for reasons that have nothing to do with the claim being tested here.
ROWS_BEFORE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")
expect 200 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":1,"purge_after_days":1,"keep_categories":["general"]}' "arm an aggressive schedule while held"
expect 200 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "run it"
want "the sweep declines to archive under hold" "$(jget "$W/resp.json" notifications_archived)" "0"
want "and declines to purge" "$(jget "$W/resp.json" notifications_purged)" "0"
want "no row of that inbox moved at all" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")" "$ROWS_BEFORE"
MAXARCH_BEFORE=$(dbq "select coalesce(max(archived_at)::text,'none') from estate_notifications where estate_id='$ESTATE'")
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N06/read" '{}' "legal hold is a purge brake, not a write freeze: the recipient can still read"
want "and even that write archived nothing: the newest archive stamp is unchanged" \
  "$(dbq "select coalesce(max(archived_at)::text,'none') from estate_notifications where estate_id='$ESTATE'")" "$MAXARCH_BEFORE"
want "hold still on after that write" "$(dbq "select legal_hold from estates where id='$ESTATE'")" "t"
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/legal-hold" \
  '{"enabled":false,"reason":"Phase 2.5a: release the rehearsal hold"}' "release the hold"
want "estate no longer held" "$(dbq "select legal_hold from estates where id='$ESTATE'")" "f"

note "--- 14. a suspended estate keeps its inbox readable and takes no inbox writes"
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/lifecycle" \
  '{"action":"suspend","reason":"Phase 2.5a: prove the notification routes inherit the gate"}' "suspend the estate"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?state=all" "a suspended estate still answers the inbox read"
want "and reports the rows it still holds" "$(jget "$W/resp.json" total)" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")"
expect 423 resident POST "/api/finance/estate/$ESTATE/notifications/$N06/archive" '{}' "archive refused while suspended"
wantsub "with the lifecycle code" 'ESTATE_NOT_ACTIVE'
expect 423 resident POST "/api/finance/estate/$ESTATE/notifications/$N06/pin" '{"pinned":true}' "pin refused while suspended"
expect 423 admin PUT "/api/finance/estate/$ESTATE/notifications/retention" '{"archive_after_days":45}' "the schedule is refused while suspended"
expect 423 admin POST "/api/finance/estate/$ESTATE/notifications/retention/run" '{}' "the sweep is refused while suspended"
expect 200 admin GET "/api/finance/estate/$ESTATE/notifications/retention" "but the schedule is still readable"
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/lifecycle" \
  '{"action":"reactivate","reason":"Phase 2.5a: resume to finish the lane"}' "reactivate"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N06/archive" '{"archived":true}' "the same write succeeds once active"
want "and the row really moved" "$(dbq "select archived_at is not null from estate_notifications where id='$N06'")" "t"
expect 200 resident POST "/api/finance/estate/$ESTATE/notifications/$N06/archive" '{"archived":false}' "put it back"

note "--- 15. the sweep function is not callable without an identity"
RPC_CODE=$(curl -sS -m 20 -o "$W/rpc.json" -w '%{http_code}' -X POST "http://127.0.0.1:54321/rpc/estate_notifications_apply_retention" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"p_estate_id\":\"$ESTATE\"}")
case "$RPC_CODE" in 401|403|404) V=0;; *) V=1;; esac
verdict "PostgREST refuses an anon EXECUTE on the sweep" "$V" "got HTTP $RPC_CODE $(head -c 120 "$W/rpc.json")"
want "and no row was archived by that attempt" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and id='$N03' and archived_at is null")" "1"

note "--- 16. closure: the inbox stays readable, the writes stop"
ROWS_PRE_CLOSE=$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")
expect 200 admin POST "/api/finance/estate-admin/estates/$ESTATE/lifecycle" \
  '{"action":"close","reason":"Phase 2.5a lane teardown"}' "close the lane estate"
expect 200 resident GET "/api/finance/estate/$ESTATE/notifications?state=all" "a closed estate still answers the inbox read (the history is retained, not erased)"
want "and it answers with the rows it had before closure" "$(jget "$W/resp.json" total)" "$ROWS_PRE_CLOSE"
expect 423 resident POST "/api/finance/estate/$ESTATE/notifications/$N01/read" '{}' "closed estate takes no write"
want "closure deleted no notification row" "$(dbq "select count(*) from estate_notifications where estate_id='$ESTATE' and user_id='$RES'")" "$ROWS_PRE_CLOSE"
want "the policy row is still there for the audit trail" "$(dbq "select count(*) from estate_notification_retention_policies where estate_id='$ESTATE'")" "1"

# The summary is only worth reading if it agrees with the transcript it sits under. A line count that
# disagrees means an assertion printed its verdict without reaching the tally — the exact bug the `verdict`
# helper was introduced to remove, so it is checked rather than trusted.
LINES_PASS=$(grep -c '^PASS' "$OUT"); LINES_FAIL=$(grep -c '^FAIL' "$OUT")
if [ "$PASS" != "$LINES_PASS" ] || [ "$FAIL" != "$LINES_FAIL" ]; then
  note "COUNTER DRIFT: tally says PASS=$PASS FAIL=$FAIL, the transcript holds $LINES_PASS/$LINES_FAIL lines"
  FAIL=$((FAIL+1))
fi
note "=== Phase 2.5a Go lane summary: PASS=$PASS FAIL=$FAIL estate=$ESTATE (transcript lines $LINES_PASS/$LINES_FAIL)"
