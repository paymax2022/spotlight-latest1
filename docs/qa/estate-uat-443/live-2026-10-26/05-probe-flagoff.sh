#!/usr/bin/env bash
# Control run: the same identities against a backend started WITHOUT
# FEATURE_ESTATE_GUARD_GRANTS (the shipped default). Proves the flag — not some
# other change — is what turns the gate surface from "any member" into
# "estate_admin or live gate grant only", and that a non-member stays refused
# either way.
set -uo pipefail

BASE=http://127.0.0.1:8094
EST=0a1e5701-0000-4000-8000-000000000001
T=/tmp/estate-uat-live/tokens
W=/tmp/estate-uat-live
OUT="$W/probe-flagoff.out"
: > "$OUT"

jwt() { cat "$T/$1.jwt"; }
uid() { tr -d '\r\n' < "$T/$1.uid"; }
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
check() { # check <want> <who> <METHOD> <path> [body] <desc>
  local want=$1 who=$2 method=$3 path=$4 body="" desc=""
  if [ $# -ge 6 ]; then body=$5; desc=$6; else desc=$5; fi
  call "$who" "$method" "$path" "$body"
  printf 'want=%s got=%s  [%s as %s] %s\n' "$want" "$CODE" "$desc" "$who" "$(head -c 160 "$W/resp.json")" | tee -a "$OUT"
}

printf '=== FEATURE_ESTATE_GUARD_GRANTS OFF (default) @ %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT"
printf 'guard grant still live in DB: %s\n' "$(uid guard)" | tee -a "$OUT"
check 200 resident GET "/api/finance/estate/$EST/guard/expected-visitors" "member with NO grant reaches gate surface (pre-#876 rule)"
check 200 resident POST "/api/finance/estate/$EST/guard/checkin" '{"numeric_code":"000000"}' "member with NO grant may attempt a checkin"
check 403 nobody GET "/api/finance/estate/$EST/guard/expected-visitors" "non-member refused regardless of flag"
check 403 nobody POST "/api/finance/estate/$EST/staff-grants" "{\"user_id\":\"$(uid guard)\",\"role\":\"gate_officer\"}" "non-member cannot delegate"
check 200 nobody GET "/api/finance/estate?limit=50" "non-member estate discovery (must be empty)"
