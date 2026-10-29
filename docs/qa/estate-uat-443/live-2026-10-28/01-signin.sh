#!/usr/bin/env bash
# Refresh the identities Phase 2.5a drives, and cache their bearer JWTs outside the repo.
#
# The four estate-UAT users already exist in the running local stack (created by the 2026-10-26 lane's
# 01-identities.sh); their access tokens expire after one hour, so this lane re-signs them rather than
# re-creating them.
#
# The two extra identities are new, and they exist for one reason: every BFF estate route resolves the
# caller's estate from their *first* membership row (`getResidentContext` does `.limit(1)` with no
# order), so an identity that belongs to two estates makes every BFF assertion about "which estate"
# ambiguous. inboxres / inboxadmin belong to the Phase 2.5a BFF estate and to nothing else, which is
# what lets that lane assert the 423 lifecycle mirror without touching a shared membership. Creating
# them is idempotent: an "already exists" reply is not an error, and the uid is re-read from the token
# subject either way. platform_users rows follow automatically (on_auth_user_created).
set -euo pipefail

REPO="${1:-.}"
WORK="${2:-/tmp/estate-uat-live}"
mkdir -p "$WORK/tokens"

ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2- | tr -d '\r')
SVC=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2- | tr -d '\r')
BASE="http://127.0.0.1:54321"
PASS='EstateUat!local-dev'

create_user() {
  local email=$1 label=$2 resp code
  resp=$(curl -sS -m 20 -w '\n%{http_code}' -X POST "$BASE/auth/v1/admin/users" \
    -H "apikey: $ANON" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\",\"email_confirm\":true,\"app_metadata\":{\"uat_label\":\"$label\"}}")
  code=$(printf '%s' "$resp" | tail -1)
  case "$code" in
    200|201) echo "created $label ($email) HTTP $code" ;;
    *) echo "create $label -> HTTP $code (already exists is fine)" ;;
  esac
}

signin() {
  local email=$1 label=$2
  curl -sS -m 20 -X POST "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 > "$WORK/tokens/$label.jwt"
  local size; size=$(wc -c < "$WORK/tokens/$label.jwt")
  local payload uid exp
  payload=$(base64 -d <(cut -d. -f2 "$WORK/tokens/$label.jwt" | tr '_-' '/+') 2>/dev/null || true)
  uid=$(printf '%s' "$payload" | grep -o '"sub":"[^"]*"' | head -1 | cut -d'"' -f4)
  exp=$(printf '%s' "$payload" | grep -o '"exp":[0-9]*' | cut -d: -f2)
  printf '%s' "$uid" > "$WORK/tokens/$label.uid"
  echo "$label uid=$uid token_bytes=$size expires=$(date -u -d "@$exp" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '?')"
}

create_user estate-uat-inbox-res@local.test  inboxres
create_user estate-uat-inbox-admin@local.test inboxadmin

signin estate-uat-admin@local.test       admin
signin estate-uat-guard@local.test       guard
signin estate-uat-resident@local.test    resident
signin estate-uat-outsider@local.test    nobody
signin estate-uat-inbox-res@local.test   inboxres
signin estate-uat-inbox-admin@local.test inboxadmin
