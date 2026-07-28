#!/usr/bin/env bash
# Guard: no secret may be exposed to a client bundle.
#
# Client-exposed vars are prefixed EXPO_PUBLIC_ (Expo/React Native) or
# NEXT_PUBLIC_ (Next.js) — anything with those prefixes is compiled into the
# shipped app and is world-readable. This script fails (exit 1) if any such var
# is named like a secret or holds a secret-shaped value. Run it in CI and as a
# pre-commit hook.
#
# Usage: scripts/check-client-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# .env files in the known project roots (client + shared). Enumerating specific
# directories keeps the scan fast and deterministic (no full-tree walk into
# node_modules / .history). Add roots here if new app packages are introduced.
ROOTS=(
  "."
  "mobile-app/reactnative"
  "frontend-web"
  "frontend-admin"
  "apps/mobile-starter"
  "backend"
)
ENV_FILES=()
for d in "${ROOTS[@]}"; do
  [ -d "$d" ] || continue
  while IFS= read -r file; do
    ENV_FILES+=("$file")
  done < <(find "$d" -maxdepth 1 -type f \( -name ".env" -o -name ".env.*" \) 2>/dev/null | sort)
done

fail=0
report() { echo "  ✗ $1"; fail=1; }

# Value shapes that indicate a real secret (NOT the xxxx/CHANGE_ME placeholders).
# - Paystack/Stripe live/test SECRET keys: sk_live_/sk_test_ followed by real chars
# - Maplerad secret: mpr_(sandbox|live)_sk_
# - Restricted keys: rk_live_/rk_test_
SECRET_VALUE_RE='=(sk_(live|test)_[A-Za-z0-9]{10,}|mpr_(sandbox|live)_sk_[A-Za-z0-9-]{10,}|rk_(live|test)_[A-Za-z0-9]{10,})'
# Placeholder markers we treat as safe.
PLACEHOLDER_RE='x{6,}|CHANGE_ME|changeme|your[_-]|REDACTED|placeholder|xxxx'

for f in "${ENV_FILES[@]}"; do
  # 1) Client vars NAMED like a secret (regardless of value).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    report "$f: client-exposed var looks secret by name → ${line%%=*}"
  done < <(grep -nE '^(EXPO_PUBLIC_|NEXT_PUBLIC_)[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE_KEY|WEBHOOK)[A-Z0-9_]*=' "$f" 2>/dev/null || true)

  # 2) Client vars holding a secret-shaped VALUE.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    report "$f: client-exposed var holds a secret-shaped value → ${line%%=*}"
  done < <(grep -nE "^(EXPO_PUBLIC_|NEXT_PUBLIC_)[A-Z0-9_]*${SECRET_VALUE_RE}" "$f" 2>/dev/null || true)

  # 3) Real (non-placeholder) secret value in a COMMITTED example template.
  case "$f" in
    *.example)
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        val="${line#*=}"
        echo "$val" | grep -qiE "$PLACEHOLDER_RE" && continue
        report "$f: committed template contains a real secret value → ${line%%=*}"
      done < <(grep -nE "${SECRET_VALUE_RE}" "$f" 2>/dev/null || true)
      ;;
  esac
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Secret-hygiene check FAILED. Secrets must live server-side only"
  echo "(backend/.env). See docs/ENV.md."
  exit 1
fi
echo "✓ client secret-hygiene check passed (${#ENV_FILES[@]} env file(s) scanned)"
