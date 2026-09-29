#!/usr/bin/env bash
#
# Create (or promote) a full admin account for the local Supabase — all four
# layers a real admin login needs, not just the Supabase Auth credential.
#
# WHY THIS EXISTS
# ----------------
# Supabase's own "Add user" dialog only creates an auth.users row (email +
# password). It has no concept of "admin" — this app's own schema decides
# that, in two places the Dashboard never touches:
#
#   1. auth.users              -> the Supabase Auth credential (GoTrue)
#   2. user_profiles.role      -> the ADMIN CONSOLE's own login gate
#      (checked by frontend-admin adminAuth.ts; 'admin'/'super-admin'/
#      'system-admin' get in, anything else is signed back out)
#   3. platform_users          -> the RBAC subject row the Go backend
#      authorizes against (auth_service.go's LoginUser checks its
#      lockout fields BEFORE GoTrue)
#   4. user_roles(super-admin) -> the actual backend authorization grant
#
# A user created only via the Dashboard has layer 1 and nothing else — they
# can authenticate, but the console signs them straight back out, and the Go
# backend has no RBAC subject to authorize at all. This script provisions
# all four in one idempotent pass, mirroring how the seeded admin/admin dev
# account is set up (supabase/migrations/20260914000001_super_admin_admin_credentials.sql).
#
# Usage:
#   scripts/dev/create-admin.sh <email> [full_name]
#   scripts/dev/create-admin.sh newadmin@spotlight.internal "New Admin"
#   ADMIN_ROLE_SLUG=admin scripts/dev/create-admin.sh support@spotlight.internal
#   ADMIN_PASSWORD='...' scripts/dev/create-admin.sh newadmin@spotlight.internal
#
# A password is generated and printed if ADMIN_PASSWORD is not set. Re-running
# for the same email is safe: the auth credential, role, and RBAC grant are
# all upserted in place rather than erroring on "already exists".
#
set -euo pipefail

EMAIL="${1:-}"
FULL_NAME="${2:-}"
ROLE_SLUG="${ADMIN_ROLE_SLUG:-super-admin}"   # console-gate role written to user_profiles.role
                                                # is always 'admin' (that gate only checks for
                                                # 'admin'/'super-admin'/'system-admin' — 'admin'
                                                # covers all of them); ROLE_SLUG picks which
                                                # backend RBAC role (public.roles.slug) is granted.

if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 <email> [full_name]" >&2
  echo "  ADMIN_ROLE_SLUG=admin|super-admin|system-admin  (default: super-admin)" >&2
  echo "  ADMIN_PASSWORD='...'                            (default: generated)" >&2
  exit 1
fi
if [[ -z "$FULL_NAME" ]]; then
  FULL_NAME="$(printf '%s' "${EMAIL%%@*}" | tr '.' ' ' | sed -e 's/\b\(.\)/\u\1/g')"
fi

ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(python3 -c "
import secrets, string
alphabet = string.ascii_letters + string.digits
pw = ''.join(secrets.choice(alphabet) for _ in range(18))
print(pw + '!A1')  # guarantee a symbol/upper/digit without biasing the random core
")"
fi

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"

repo_root() { cd "$(dirname "$0")/../.." && pwd; }
ROOT="$(repo_root)"

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

# HARD SAFETY GATE. This mints real admin credentials; it must never be
# pointed at a deployed project. Local Supabase only, no override flag on
# purpose — same gate as ensure-dev-login.sh.
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "✗ Refusing to run: SUPABASE_URL is '$SUPABASE_URL'." >&2
    echo "  This mints admin credentials and is for a LOCAL Supabase only." >&2
    exit 1
    ;;
esac

echo "Supabase: $SUPABASE_URL"
echo "Email:    $EMAIL"
echo "Role:     $ROLE_SLUG"
echo

# ── 1. auth.users — create if absent, otherwise reset password in place ────
#
# CRITICAL: the lookup MUST be an exact, server-filtered match. GoTrue's admin
# list endpoint's `email=` query param does NOT reliably filter (verified: it
# silently ignores it and returns page-1/per_page-1 = "whatever's first"
# regardless of the value passed) — trusting it here previously caused this
# script to find a WRONG, unrelated pre-existing user on every run and rename
# THAT ACCOUNT to the target email via the PUT body's "email" field, clobbering
# it. Never repeat that: require a real SQL lookup (same technique
# ensure-dev-login.sh uses for exactly this reason) and refuse to guess.
DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" ]]; then
  for f in "$ROOT/backend/.env" "$ROOT/frontend-admin/.env.local" "$ROOT/frontend-web/.env.local"; do
    DATABASE_URL="$(read_env DATABASE_URL "$f" || true)"
    [[ -n "$DATABASE_URL" ]] && break
  done
fi
if [[ -z "$DATABASE_URL" ]] || ! command -v psql >/dev/null 2>&1; then
  echo "✗ Need both DATABASE_URL and psql for a reliable exact-email lookup — refusing to fall back to GoTrue's admin list filter (proven unreliable)." >&2
  exit 1
fi

uid="$(psql "$DATABASE_URL" -t -A -c \
  "select id from auth.users where lower(email) = lower('$(printf '%s' "$EMAIL" | sed "s/'/''/g")') limit 1;" \
  2>/dev/null | tr -d '[:space:]')"

if [[ -z "$uid" ]]; then
  create_body="$(EMAIL="$EMAIL" PW="$ADMIN_PASSWORD" NAME="$FULL_NAME" python3 -c '
import json, os
print(json.dumps({
    "email": os.environ["EMAIL"],
    "password": os.environ["PW"],
    "email_confirm": True,
    "user_metadata": {"full_name": os.environ["NAME"], "role": "admin"},
}))
')"
  create_out="$(curl -sS --max-time 20 -X POST "$SUPABASE_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "$create_body")"
  uid="$(printf '%s' "$create_out" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("id",""))
except Exception:
    print("")')"
  if [[ -z "$uid" ]]; then
    echo "✗ auth user creation failed: $(printf '%s' "$create_out" | head -c 300)" >&2
    exit 1
  fi
  echo "✓ auth user created ($uid)"
else
  # Update path deliberately omits "email" from the body — this account was
  # already matched BY email, so there is never a reason to change it here,
  # and leaving it out is a second, independent guard against ever repeating
  # the clobber above even if the lookup above were somehow wrong again.
  update_body="$(PW="$ADMIN_PASSWORD" NAME="$FULL_NAME" python3 -c '
import json, os
print(json.dumps({
    "password": os.environ["PW"],
    "email_confirm": True,
    "user_metadata": {"full_name": os.environ["NAME"], "role": "admin"},
}))
')"
  curl -sS --max-time 20 -X PUT "$SUPABASE_URL/auth/v1/admin/users/$uid" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "$update_body" >/dev/null
  echo "✓ auth user already existed ($uid) — password/metadata reset in place"
fi

# ── 2. user_profiles.role — the admin console's own login gate ─────────────
# handle_new_user() should already have set this from user_metadata.role on
# insert; PATCH explicitly anyway so this doesn't silently depend on that
# trigger still existing.
curl -sS --max-time 20 -X PATCH \
  "$SUPABASE_URL/rest/v1/user_profiles?id=eq.$uid" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"role":"admin"}' >/dev/null
echo "✓ console gate set (user_profiles.role=admin)"

# ── 3. platform_users — the RBAC subject row the Go backend authorizes against
PLATFORM_USER_BODY="$(UID_="$uid" EMAIL="$EMAIL" NAME="$FULL_NAME" python3 -c '
import os, json, datetime
first, _, last = os.environ["NAME"].partition(" ")
print(json.dumps({
    "id": os.environ["UID_"],
    "first_name": first or "Admin",
    "last_name": last,
    "email": os.environ["EMAIL"],
    "user_type": "admin",
    "status": "active",
    "email_verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}))
')"

curl -sS --max-time 20 -X POST "$SUPABASE_URL/rest/v1/platform_users" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "$PLATFORM_USER_BODY" >/dev/null
echo "✓ RBAC subject row upserted (platform_users, status=active)"

# ── 4. user_roles — the actual backend authorization grant ─────────────────
role_id="$(curl -sS --max-time 20 "$SUPABASE_URL/rest/v1/roles?slug=eq.$ROLE_SLUG&select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  | python3 -c 'import sys,json
r=json.load(sys.stdin)
print(r[0]["id"] if r else "")')"

if [[ -z "$role_id" ]]; then
  echo "✗ role slug '$ROLE_SLUG' does not exist in public.roles — not granted." >&2
  echo "  (super-admin is seeded by 20260914000001_super_admin_admin_credentials.sql; other slugs may need their own migration first.)" >&2
  exit 1
fi

existing_grant="$(curl -sS --max-time 20 \
  "$SUPABASE_URL/rest/v1/user_roles?user_id=eq.$uid&role_id=eq.$role_id&scope_type=eq.global&select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  | python3 -c 'import sys,json
r=json.load(sys.stdin)
print(r[0]["id"] if r else "")')"

if [[ -z "$existing_grant" ]]; then
  curl -sS --max-time 20 -X POST "$SUPABASE_URL/rest/v1/user_roles" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d "{\"user_id\":\"$uid\",\"role_id\":\"$role_id\",\"scope_type\":\"global\",\"is_active\":true}" >/dev/null
  echo "✓ role granted ($ROLE_SLUG, global)"
else
  curl -sS --max-time 20 -X PATCH \
    "$SUPABASE_URL/rest/v1/user_roles?id=eq.$existing_grant" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d '{"is_active":true}' >/dev/null
  echo "✓ role grant already existed ($ROLE_SLUG, global) — re-activated"
fi

# ── 5. verify, rather than assume the writes took ───────────────────────────
token="$(curl -sS --max-time 20 -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d "$(EMAIL="$EMAIL" PW="$ADMIN_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["PW"]}))')" \
  | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("access_token",""))
except Exception:
    print("")')"

role_now="$(curl -sS --max-time 20 "$SUPABASE_URL/rest/v1/user_profiles?id=eq.$uid&select=role" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  | python3 -c 'import sys,json
r=json.load(sys.stdin)
print(r[0].get("role","") if r else "")')"

echo
if [[ -n "$token" && "$role_now" == "admin" ]]; then
  echo "✓ verified: GoTrue password grant works AND the console gate passes"
else
  echo "✗ verification FAILED — token=$([ -n "$token" ] && echo ok || echo missing), user_profiles.role='$role_now'" >&2
  exit 1
fi

echo
echo "──────────────────────────────────────────────"
echo "  Admin account ready"
echo "  Login (frontend-admin console): $EMAIL"
echo "  Password:                       $ADMIN_PASSWORD"
echo "  Backend RBAC role:               $ROLE_SLUG (global)"
echo "  auth.users id:                   $uid"
echo "──────────────────────────────────────────────"
echo "Save the password now — this script does not store it anywhere."
