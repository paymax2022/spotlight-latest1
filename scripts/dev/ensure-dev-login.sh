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
# It repairs ALL THREE layers a login must pass, which is the other half of why
# this kept recurring — fixing only the first leaves you with a correct password
# and a still-failing login:
#
#   1. The GoTrue credential            -> PUT /auth/v1/admin/users/{id}
#   2. platform_users' lockout gate     -> status / failed_login_attempts /
#      (checked BEFORE GoTrue by           locked_until
#       auth_service.go LoginUser)
#   3. user_profiles.role               -> the ADMIN CONSOLE's own gate
#      (checked AFTER GoTrue by
#       frontend-admin adminAuth.ts)
#
# Layer 3 was added on 2026-09-01 after admin@spotlight.internal failed to log
# into the console with a perfectly good password. It authenticated, and then
# adminAuth.ts read user_profiles.role, found 'USER', called signOut() and threw
# "Access denied. Admin privileges required." Layers 1 and 2 were both already
# healthy — so this script reported success while the console stayed shut, which
# is precisely the "correct password, still-failing login" trap the note above
# warns about. It just did not cover the third layer yet.
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

# Accounts this script will grant user_profiles.role='admin'. DELIBERATELY a
# separate, explicit list rather than "whatever was passed in": the console gate
# is an authorisation boundary, and a script that silently hands admin to any
# email on its command line is a privilege-escalation tool wearing a repair
# script's clothes. An account outside this list still gets layers 1 and 2.
ADMIN_ROLE_ACCOUNTS=(
  "admin@spotlight.internal"
  "qa-claude-test@spotlight.internal"
)

is_admin_fixture() {
  local want="$1" a
  for a in "${ADMIN_ROLE_ACCOUNTS[@]}"; do
    [[ "$a" == "$want" ]] && return 0
  done
  return 1
}

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

  # 3) the ADMIN CONSOLE's gate. adminAuth.ts signs in, reads user_profiles.role
  #    and signs you straight back out unless it is 'admin' or a finance_* role.
  #    Note the comparison there is CASE-SENSITIVE (role !== 'admin'), so a row
  #    reading 'ADMIN' or 'USER' fails identically — write lowercase.
  #    Only for the fixtures on the allowlist; see ADMIN_ROLE_ACCOUNTS.
  if is_admin_fixture "$email"; then
    curl -sS --max-time 20 -X PATCH \
      "$SUPABASE_URL/rest/v1/user_profiles?id=eq.$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" \
      -d '{"role":"admin"}' >/dev/null && \
      echo "   ✓ console role set (user_profiles.role=admin)"
  else
    echo "   · not on ADMIN_ROLE_ACCOUNTS — console role left untouched"
  fi

  # 4) prove it, rather than assuming the writes took
  if curl -sS --max-time 20 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
      -d "$(DEV_LOGIN_PASSWORD="$DEV_LOGIN_PASSWORD" EMAIL="$email" python3 -c 'import json,os; print(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["DEV_LOGIN_PASSWORD"]}))')" \
      | grep -q '"access_token"'; then
    echo "   ✓ verified: GoTrue password grant returns a token"
  else
    echo "   ✗ verification FAILED — the grant still rejects this password"
    failed=1
  fi

  # 5) and prove the CONSOLE gate too. A token proves GoTrue is happy; it says
  #    nothing about whether adminAuth.ts will let you past. Reading the role
  #    back is what turns "password works" into "you can actually get in" —
  #    without it this script can report total success on an account the console
  #    refuses, which is exactly what happened on 2026-09-01.
  if is_admin_fixture "$email"; then
    role_now="$(curl -sS --max-time 20 \
      "$SUPABASE_URL/rest/v1/user_profiles?id=eq.$uid&select=role" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      | python3 -c 'import sys,json
try:
    r=json.load(sys.stdin)
    print(r[0].get("role","") if r else "")
except Exception:
    print("")')"
    if [[ "$role_now" == "admin" ]]; then
      echo "   ✓ verified: console gate passes (user_profiles.role=admin)"
    else
      echo "   ✗ console gate FAILS — user_profiles.role is '${role_now:-<missing>}', not 'admin'"
      echo "     The password is fine; the admin console will still refuse this account."
      failed=1
    fi
  fi
  echo
done

if [[ $failed -ne 0 ]]; then
  echo "✗ One or more accounts could not be restored." >&2
  exit 1
fi

echo "✓ Dev login restored. Password: \$DEV_LOGIN_PASSWORD (default documented in this script)."
echo "  All three layers asserted: GoTrue credential, platform_users lockout, and"
echo "  user_profiles.role (the admin console's own gate)."
echo "  If a login still fails, it is NOT the password and NOT the role — check"
echo "  the app layer (Go :8091 / Next :3000) rather than resetting anything."
