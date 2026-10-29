#!/usr/bin/env bash
# Refresh the four estate-UAT identity tokens used by 07-probe-profile.sh.
#
# The GoTrue users already exist in the running local stack (created by the 2026-10-26 lane's
# 01-identities.sh) and their JWTs expire after one hour, so this lane re-signs them in rather than
# re-creating them. Tokens are cached outside the repo.
set -euo pipefail

REPO="${1:-.}"
WORK="${2:-/tmp/estate-uat-live}"
mkdir -p "$WORK/tokens"

ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2- | tr -d '\r')
BASE="http://127.0.0.1:54321"
PASS='EstateUat!local-dev'

signin() {
  local email=$1 label=$2
  curl -sS -m 20 -X POST "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 > "$WORK/tokens/$label.jwt"
  local size; size=$(wc -c < "$WORK/tokens/$label.jwt")
  local payload uid
  payload=$(base64 -d <(cut -d. -f2 "$WORK/tokens/$label.jwt" | tr '_-' '/+') 2>/dev/null || true)
  uid=$(printf '%s' "$payload" | grep -o '"sub":"[^"]*"' | head -1 | cut -d'"' -f4)
  exp=$(printf '%s' "$payload" | grep -o '"exp":[0-9]*' | cut -d: -f2)
  echo "$uid" > "$WORK/tokens/$label.uid"
  echo "$label uid=$uid token_bytes=$size expires=$(date -u -d "@$exp" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "?")"
}

signin estate-uat-admin@local.test    admin
signin estate-uat-guard@local.test    guard
signin estate-uat-resident@local.test resident
signin estate-uat-outsider@local.test nobody
