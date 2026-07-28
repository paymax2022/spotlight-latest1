#!/usr/bin/env bash
#
# qa-auth-rbac-e2e.sh — live end-to-end auth/RBAC journeys for the Spotlight super-app.
#
# Drives the REAL running backend + local Supabase + Postgres and asserts the auth
# front door: token validation, the account-status gate (suspended/locked/deleted),
# RBAC deny-by-default, and the full grant -> allow -> revoke -> deny lifecycle.
# It creates a throwaway Supabase user, runs the journeys, and deletes it (trap EXIT).
#
# Companion to docs/qa/auth-rbac-superapp-test-plan.md (the manual/E2E plan) and the
# docs/qa/cross-cutting/{authentication,rbac-and-permissions}.md case IDs.
#
# PREREQUISITES (all local dev):
#   - Supabase running:      supabase start        (Auth :54321, DB :54322)
#   - Backend running:       (cd backend && set -a; source .env; set +a; go run ./cmd/server)
#   - Tools:                 curl, psql, python3, supabase CLI
#
# USAGE:
#   ./scripts/qa-auth-rbac-e2e.sh
#
# CONFIG (override via env):
#   API_BASE   backend base URL            (default http://127.0.0.1:8091)
#   SB_URL     Supabase Auth/API URL       (default http://127.0.0.1:54321)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  (default local supabase db)
#
# EXIT CODE: non-zero if any P0 gate journey fails. The two config-dependent
# observations (empty ADMIN_API_KEY, unguarded STEM writes) are reported as WARN,
# not failures, since they depend on the environment's config/brownfield state.

set -uo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8091}"
SB_URL="${SB_URL:-http://127.0.0.1:54321}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-54322}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGDATABASE="${PGDATABASE:-postgres}"

# Protected route that runs RequireAuthContext (Bearer/Supabase gate).
AUTH_ROUTE="/api/v1/connect/onboarding/status"
# Route that runs RequireAuthContext + RequirePermission("finance.admin.kyc").
PERM_ROUTE="/api/finance/admin/kyc/review-queue"
PERM_SLUG="finance.admin.kyc"
PERM_ROLE="system-admin"           # a seeded role that holds PERM_SLUG
# Public STEM write (brownfield exposure check).
STEM_WRITE="/api/v1/stem-contests"
# Admin-key gated route (config check).
ADMIN_ROUTE="/api/v1/admin/menu-counts"

PASS=0; FAIL=0; WARN=0
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }

# check <case-id> <description> <expected> <actual>
check() {
  local id="$1" desc="$2" exp="$3" act="$4"
  if [[ "$act" == "$exp" ]]; then
    printf '  [%s] %-8s %-52s expected %s got %s\n' "$(green PASS)" "$id" "$desc" "$exp" "$act"
    PASS=$((PASS+1))
  else
    printf '  [%s] %-8s %-52s expected %s got %s\n' "$(red FAIL)" "$id" "$desc" "$exp" "$act"
    FAIL=$((FAIL+1))
  fi
}
warn() { printf '  [%s] %-8s %s\n' "$(yellow WARN)" "$1" "$2"; WARN=$((WARN+1)); }

code() { # code <curl args...> -> prints HTTP status
  curl -s -o /dev/null -w '%{http_code}' "$@"
}
psql_do() { psql -tAc "$1" 2>/dev/null; }

# ── Prerequisites ────────────────────────────────────────────────────────────
for bin in curl psql python3 supabase; do
  command -v "$bin" >/dev/null 2>&1 || { echo "FATAL: '$bin' not found in PATH"; exit 2; }
done
if [[ "$(code "$API_BASE/api/v1/public/health")" != "200" ]]; then
  echo "FATAL: backend not healthy at $API_BASE (GET /api/v1/public/health != 200)."
  echo "       Start it: (cd backend && set -a; source .env; set +a; go run ./cmd/server)"
  exit 2
fi
if ! psql_do "select 1" >/dev/null 2>&1; then
  echo "FATAL: cannot reach Postgres at $PGHOST:$PGPORT. Is 'supabase start' running?"
  exit 2
fi

# Supabase keys (never printed).
eval "$(supabase status -o env 2>/dev/null | grep -iE 'ANON_KEY|SERVICE_ROLE_KEY')"
: "${ANON_KEY:?FATAL: could not read ANON_KEY from 'supabase status -o env'}"
: "${SERVICE_ROLE_KEY:?FATAL: could not read SERVICE_ROLE_KEY from 'supabase status -o env'}"

# ── Test user lifecycle (auto-cleaned) ───────────────────────────────────────
EMAIL="qa-authrbac-$(date +%s)-$$@example.com"
PW="Test-Passw0rd!"
USER_ID=""   # NB: not UID — UID is a readonly shell variable
cleanup() {
  [[ -n "$USER_ID" ]] || return 0
  psql_do "delete from user_roles where user_id='$USER_ID';" >/dev/null 2>&1
  psql_do "delete from platform_users where id='$USER_ID';" >/dev/null 2>&1
  curl -s -o /dev/null -X DELETE "$SB_URL/auth/v1/admin/users/$USER_ID" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  echo "  (cleaned up test user $USER_ID)"
}
trap cleanup EXIT

USER_ID=$(curl -s -X POST "$SB_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
[[ -n "$USER_ID" ]] || { echo "FATAL: could not create test user"; exit 2; }
TOKEN=$(curl -s -X POST "$SB_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[[ -n "$TOKEN" ]] || { echo "FATAL: could not obtain access token"; exit 2; }
AUTH=(-H "Authorization: Bearer $TOKEN")

echo "Spotlight auth/RBAC live E2E  —  backend=$API_BASE  user=$USER_ID"
echo

# ── 1. Authentication: token validation (TOKEN-SEC / AUTHN) ──────────────────
echo "1) Authentication — token validation"
check "TOKEN-SEC-001" "anonymous -> protected"          401 "$(code "$API_BASE$AUTH_ROUTE")"
check "TOKEN-SEC-001" "malformed header 'Token abc'"    401 "$(code -H 'Authorization: Token abc' "$API_BASE$AUTH_ROUTE")"
check "TOKEN-SEC-002" "invalid bearer token"            401 "$(code -H 'Authorization: Bearer not.a.jwt' "$API_BASE$AUTH_ROUTE")"
check "AUTH-INT-001"  "valid Supabase token"            200 "$(code "${AUTH[@]}" "$API_BASE$AUTH_ROUTE")"

# ── 2. Account-status gate (STATUS-SEC / AUTH-SEC) ───────────────────────────
echo "2) Account-status gate (platform_users.status)"
set_status() {
  psql_do "insert into public.platform_users (id, first_name, last_name, email, user_type, status)
           values ('$USER_ID','QA','Test','$EMAIL','registered_user','$1')
           on conflict (id) do update set status=excluded.status;" >/dev/null
}
for st in suspended locked deleted; do
  set_status "$st"
  check "STATUS-SEC" "status=$st blocked"               403 "$(code "${AUTH[@]}" "$API_BASE$AUTH_ROUTE")"
done
set_status active
check "STATUS-SEC-006" "status=active restores access"  200 "$(code "${AUTH[@]}" "$API_BASE$AUTH_ROUTE")"

# ── 3. RBAC: deny-by-default (RBAC-AUTHZ) ────────────────────────────────────
echo "3) RBAC — authorization"
check "RBAC-AUTHZ-003" "anon on perm-gated route -> 401" 401 "$(code "$API_BASE$PERM_ROUTE")"
check "RBAC-AUTHZ-001" "authed, NO permission -> 403"    403 "$(code "${AUTH[@]}" "$API_BASE$PERM_ROUTE")"

# ── 4. RBAC: grant -> allow -> revoke -> deny (RBAC-E2E-001 / ROLE-SEC-006) ───
RID=$(psql_do "select id from roles where slug='$PERM_ROLE' limit 1;")
if [[ -n "$RID" ]]; then
  psql_do "insert into user_roles (user_id, role_id, is_active) values ('$USER_ID','$RID',true) on conflict do nothing;" >/dev/null
  check "RBAC-E2E-001" "after GRANT $PERM_ROLE -> 200"   200 "$(code "${AUTH[@]}" "$API_BASE$PERM_ROUTE")"
  psql_do "update user_roles set is_active=false where user_id='$USER_ID' and role_id='$RID';" >/dev/null
  check "ROLE-SEC-006" "after REVOKE -> 403 (no cache)"  403 "$(code "${AUTH[@]}" "$API_BASE$PERM_ROUTE")"
else
  warn "RBAC-E2E-001" "role '$PERM_ROLE' not seeded — skipped grant/revoke journey"
fi

# ── 5. Config / brownfield observations (WARN, not gate failures) ────────────
echo "5) Config & brownfield observations"
admin_nokey="$(code "$API_BASE$ADMIN_ROUTE")"
if [[ "$admin_nokey" == "200" ]]; then
  warn "SVC-SEC-002" "admin route $ADMIN_ROUTE returns 200 with NO x-admin-api-key — set ADMIN_API_KEY before go-live"
else
  check "SVC-SEC-002" "admin route requires key"        401 "$admin_nokey" 2>/dev/null || \
    printf '  [%s] %-8s admin route -> %s (key enforced)\n' "$(green PASS)" "SVC-SEC-002" "$admin_nokey"
fi
stem_write="$(code -X POST -H 'Content-Type: application/json' -d '{}' "$API_BASE$STEM_WRITE")"
if [[ "$stem_write" == "401" || "$stem_write" == "403" ]]; then
  printf '  [%s] %-8s STEM public write is auth-gated (%s)\n' "$(green PASS)" "CONTEST-SEC-001" "$stem_write"
else
  warn "CONTEST-SEC-001" "anonymous POST $STEM_WRITE -> $stem_write (reaches handler; not auth-gated — brownfield)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo
echo "Summary: $(green "$PASS passed"), $(red "$FAIL failed"), $(yellow "$WARN warnings")"
[[ "$FAIL" -eq 0 ]] || exit 1
