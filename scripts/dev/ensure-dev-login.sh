#!/usr/bin/env bash
#
# Restore local dev login for the shared fixture accounts — idempotently, and to
# a value every session agrees on.
#
# WHY THIS EXISTS
# ---------------
# This repo runs many concurrent Claude/worktree sessions against ONE local
# Supabase, and they all reach for the same manual-login fixture
# (admin@spotlight.internal). When a session hit a 401 it reset the password to
# a value of its own choosing, which invalidated every other session, which then
# hit a 401 and reset it again. The account's password changed several times in
# a single afternoon and no recorded value stayed true for long.
#
# The loop is not caused by resetting the password — it is caused by resetting it
# to a DIFFERENT value each time. So this script exists to make recovery
# deterministic: whoever runs it converges on the same documented password, and
# running it twice (or from five worktrees at once) leaves the same end state.
# Reach for this instead of inventing a password.
#
# It repairs BOTH layers a login must pass, which is the other half of why this
# kept recurring — fixing only the first leaves you with a correct password and
# a still-failing login:
#
#   1. The GoTrue credential            -> PUT /auth/v1/admin/users/{id}
#   2. platform_users' lockout gate     -> status / failed_login_attempts /
#      (checked BEFORE GoTrue by           locked_until
#       auth_service.go LoginUser)
#
# platform_users.password_hash is deliberately NOT touched: LoginUser
# authenticates via the GoTrue password grant (auth_service.go:232) and never
# consults that column, so writing it would add a third source of truth that
# nothing reads.
#
# Usage:
#   scripts/dev/ensure-dev-login.sh                  # all default fixtures
#   scripts/dev/ensure-dev-login.sh a@b.com c@d.com  # specific accounts
#   DEV_LOGIN_PASSWORD='...' scripts/dev/ensure-dev-login.sh
#
set -euo pipefail

# One documented value. Change it here, not per session — a per-session value is
# precisely the failure this script prevents.
DEV_LOGIN_PASSWORD="${DEV_LOGIN_PASSWORD:-LocalDevAdmin123!}"

DEFAULT_ACCOUNTS=(
  "admin@spotlight.internal"
  "qa-claude-test@spotlight.internal"
)

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"

repo_root() { cd "$(dirname "$0")/../.." && pwd; }
ROOT="$(repo_root)"

# Read a var out of an env file without sourcing it (these files contain values
# with spaces, '#' and quotes that a bare `source` mangles).
read_env() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 1
  local v
  v="$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" | sed 's/[[:space:]]*#.*$//' | xargs 2>/dev/null || true)"
  [[ -n "$v" ]] && printf '%s' "$v"
}

SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "$SERVICE_ROLE_KEY" ]]; then
  for f in "$ROOT/frontend-admin/.env.local" "$ROOT/frontend-web/.env.local" "$ROOT/backend/.env"; do
    SERVICE_ROLE_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY "$f" || true)"
    [[ -n "$SERVICE_ROLE_KEY" ]] && break
  done
fi
if [[ -z "$SERVICE_ROLE_KEY" ]]; then
  echo "✗ No SUPABASE_SERVICE_ROLE_KEY found (env, frontend-admin/.env.local, frontend-web/.env.local, backend/.env)." >&2
  exit 1
fi

# HARD SAFETY GATE. This script rewrites passwords; it must never be pointed at a
# deployed project. Local Supabase only, no override flag on purpose.
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "✗ Refusing to run: SUPABASE_URL is '$SUPABASE_URL'." >&2
    echo "  This resets passwords and is for a LOCAL Supabase only." >&2
    exit 1
    ;;
esac

ACCOUNTS=("$@")
[[ ${#ACCOUNTS[@]} -eq 0 ]] && ACCOUNTS=("${DEFAULT_ACCOUNTS[@]}")

echo "Supabase: $SUPABASE_URL"
echo

# One listing, reused for every account.
USERS_JSON="$(curl -sS --max-time 20 \
  "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=1000" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")"

failed=0
for email in "${ACCOUNTS[@]}"; do
  printf '%s\n' "── $email"

  uid="$(printf '%s' "$USERS_JSON" | EMAIL="$email" python3 -c '
import sys, json, os
raw = json.load(sys.stdin)
users = raw.get("users", raw if isinstance(raw, list) else [])
want = os.environ["EMAIL"].lower()
print(next((u["id"] for u in users if (u.get("email") or "").lower() == want), ""))
')"

  if [[ -z "$uid" ]]; then
    echo "   ✗ no auth user with that email — skipping (create it first)"
    failed=1
    continue
  fi

  # 1) the credential
  set_out="$(curl -sS --max-time 20 -X PUT "$SUPABASE_URL/auth/v1/admin/users/$uid" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$(DEV_LOGIN_PASSWORD="$DEV_LOGIN_PASSWORD" python3 -c 'import json,os; print(json.dumps({"password": os.environ["DEV_LOGIN_PASSWORD"]}))')")"
  if printf '%s' "$set_out" | grep -q '"id"'; then
    echo "   ✓ password set"
  else
    echo "   ✗ password set failed: $(printf '%s' "$set_out" | head -c 160)"
    failed=1
  fi

  # 2) the lockout gate LoginUser checks first. PATCH is a no-op when already
  #    clear, which is what makes re-running safe.
  curl -sS --max-time 20 -X PATCH \
    "$SUPABASE_URL/rest/v1/platform_users?email=eq.$(printf '%s' "$email" | sed 's/+/%2B/g')" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d '{"status":"active","failed_login_attempts":0,"locked_until":null}' >/dev/null && \
    echo "   ✓ lockout cleared (status=active, attempts=0, locked_until=null)"

  # 3) prove it, rather than assuming the writes took
  if curl -sS --max-time 20 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
      -d "$(DEV_LOGIN_PASSWORD="$DEV_LOGIN_PASSWORD" EMAIL="$email" python3 -c 'import json,os; print(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["DEV_LOGIN_PASSWORD"]}))')" \
      | grep -q '"access_token"'; then
    echo "   ✓ verified: GoTrue password grant returns a token"
  else
    echo "   ✗ verification FAILED — the grant still rejects this password"
    failed=1
  fi
  echo
done

if [[ $failed -ne 0 ]]; then
  echo "✗ One or more accounts could not be restored." >&2
  exit 1
fi

echo "✓ Dev login restored. Password: \$DEV_LOGIN_PASSWORD (default documented in this script)."
echo "  If a login still fails, it is NOT the password — check the app layer"
echo "  (Go :8091 / Next :3000) rather than resetting anything."
