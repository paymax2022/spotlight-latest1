#!/usr/bin/env bash
# smoke.sh — quick liveness + route sanity check against the local Docker stack.
# Usage: ./smoke.sh [BASE_URL]
# Defaults to http://localhost:8080

set -euo pipefail

BASE="${1:-http://localhost:8080}"
PASS=0
FAIL=0

check() {
  local label="$1" method="$2" url="$3" expected="$4"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url")
  if [ "$status" = "$expected" ]; then
    echo "  PASS  [$status] $method $url"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  [$status != $expected] $method $url  ($label)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke test → $BASE"
echo ""

echo "── Liveness ─────────────────────────────────────────────"
check "public health"        GET  "$BASE/api/v1/public/health"        200

echo ""
echo "── Auth (expect 400/422 on empty body, not 404/500) ────"
check "login empty body"     POST "$BASE/api/auth/login"           400
check "register empty body"  POST "$BASE/api/auth/register"        400

echo ""
echo "── Protected (expect 401 without token) ────────────────"
check "me unauthenticated"   GET  "$BASE/api/auth/me"              401

echo ""
echo "── Admin (expect 401/403 without key) ──────────────────"
check "admin no key"         GET  "$BASE/api/admin/users"          401

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "All $PASS checks passed."
else
  echo "$PASS passed, $FAIL failed."
  exit 1
fi
