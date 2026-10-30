#!/usr/bin/env bash
# Create the three local identities the estate guard-authz lane needs, then sign
# each one in and cache the access tokens outside the repo.
set -euo pipefail

REPO="$1"
WORK="${2:-/tmp/estate-uat-live}"
mkdir -p "$WORK/tokens"

ANON=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2-)
SVC=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$REPO/frontend-web/.env.local" | cut -d= -f2-)
BASE="http://127.0.0.1:54321"
PASS='EstateUat!local-dev'

create_user() {
  local email="$1" label="$2"
  local resp code
  resp=$(curl -sS -m 20 -w '\n%{http_code}' -X POST "$BASE/auth/v1/admin/users" \
    -H "apikey: $ANON" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\",\"email_confirm\":true,\"app_metadata\":{\"uat_label\":\"$label\"}}")
  code=$(printf '%s' "$resp" | tail -1)
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    printf '%s' "$resp" | head -n -1 | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 > "$WORK/tokens/$label.uid"
    echo "created $label $code"
  else
    echo "create $label -> HTTP $code (may already exist)"
  fi
}

signin() {
  local email="$1" label="$2"
  curl -sS -m 20 -X POST "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4 > "$WORK/tokens/$label.jwt"
  local size; size=$(wc -c < "$WORK/tokens/$label.jwt")
  echo "signin $label: token bytes=$size"
}

for pair in "estate-uat-admin@local.test:admin" "estate-uat-guard@local.test:guard" "estate-uat-resident@local.test:resident"; do
  email=${pair%%:*}; label=${pair##*:}
  create_user "$email" "$label" || true
  signin "$email" "$label"
done

# Re-resolve uid from the token subject (sub claim) so it matches auth.users row.
for label in admin guard resident; do
  f="$WORK/tokens/$label.jwt"
  [ -s "$f" ] || { echo "MISSING token $label"; exit 1; }
  payload=$(base64 -d <(cut -d. -f2 "$f" | tr '_-' '/+' 2>/dev/null) 2>/dev/null || true)
  uid=$(printf '%s' "$payload" | grep -o '"sub":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "$uid" > "$WORK/tokens/$label.uid"
  echo "$label uid=$uid"
done
