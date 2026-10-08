#!/bin/bash
# Seed N load-test users into local Supabase GoTrue via the admin API.
# Usage: SUPABASE_SERVICE_ROLE_KEY=<key> ./seed-users.sh [N]
#   (SRK falls back to backend/.env / frontend-web/.env.local if unset)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
N="${1:-200}"
PASSWORD="${LOADTEST_PASSWORD:-LoadTest123!}"

read_env() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '"'"'" | xargs || true
}

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SRK="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "$SRK" ]]; then
  for f in "$ROOT/backend/.env" "$ROOT/frontend-web/.env.local"; do
    SRK="$(read_env SUPABASE_SERVICE_ROLE_KEY "$f" || true)"
    [[ -n "$SRK" ]] && break
  done
fi
[[ -n "$SRK" ]] || { echo "SUPABASE_SERVICE_ROLE_KEY not set and not found in env files" >&2; exit 1; }

ok=0; fail=0
for i in $(seq 1 "$N"); do
  email="loadtest-$(printf '%03d' "$i")@spotlight.internal"
  res=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")
  if [[ "$res" == "200" || "$res" == "422" ]]; then ok=$((ok+1)); else fail=$((fail+1)); echo "  $email -> $res" >&2; fi
done
echo "users ready=$ok failed=$fail (password: $PASSWORD)"
