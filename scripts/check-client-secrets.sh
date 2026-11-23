#!/usr/bin/env bash
# Guard: no secret may be exposed to a client bundle.
#
# Client-exposed vars are prefixed EXPO_PUBLIC_ (Expo/React Native) or
# NEXT_PUBLIC_ (Next.js) — anything with those prefixes is compiled into the
# shipped app and is world-readable. This script fails (exit 1) if any such var
# is named like a secret or holds a secret-shaped value. Run it in CI and as a
# pre-commit hook.
#
# Two rules are not client-bundle-specific and exist because a credential that
# reaches the repo is compromised even if no bundle reads it (docs/runbooks/
# SECRET-ROTATION.md Step 4 asked for both): a tree-wide scan for console-minted
# provider tokens in any tracked file, and a refusal to let a live `.env`
# snapshot be tracked where only templates should be.
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
# - Legacy provider secret shape mpr_(sandbox|live)_sk_ (provider removed; kept so
#   previously leaked keys are still caught)
# - Restricted keys: rk_live_/rk_test_
SECRET_VALUE_RE='=(sk_(live|test)_[A-Za-z0-9]{10,}|mpr_(sandbox|live)_sk_[A-Za-z0-9-]{10,}|rk_(live|test)_[A-Za-z0-9]{10,})'
# Placeholder markers we treat as safe.
PLACEHOLDER_RE='x{6,}|CHANGE_ME|changeme|your[_-]|REDACTED|placeholder|xxxx'

# Console-minted provider tokens: opaque, prefixed, and never hand-typed as a
# placeholder. A `****` mask (docs/devops/deployment-matrix.md publishes previews of
# the Railway project tokens that way) breaks every one of these shapes, so masked
# documentation stays green while a pasted live value does not.
#   rlwy_proj_  Railway project token (repo + environment scoped)   — the one that
#   rkt_        Railway CLI/API token                                reached a
#   github_pat_ GitHub fine-grained PAT                              tracked sample
#   gh[pousr]_  GitHub classic PAT / oauth / refresh / user-to-server
# Measured 2026-11-19 over every tracked file on origin/main: 0 matches, so the
# tree-wide rules below cannot redden an existing checkout — they redden only a
# checkout where a live credential was actually pasted.
TOKEN_SHAPE_RE='rlwy_proj_[A-Za-z0-9]{20,}|rkt_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}'
# These files must carry the prefixes literally to detect them; never self-flag.
SELF_PATHS=("scripts/check-client-secrets.sh" "scripts/ci/test-check-client-secrets.sh")

# Tracked files that are live env snapshots rather than templates. `.env`,
# `.env.local`, the timestamped `.env_YYYYMMDDHHMMSS[.local]` snapshots the Local
# History extension wrote, and any `.env.<anything>` — except deliberate templates,
# which end in .example / .sample / .template / .enc.
ENV_SNAPSHOT_RE='(^|/)\.env([._][^/]*)?$'
TEMPLATE_SUFFIX_RE='\.(example|sample|template|enc)$'

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

  # 4) Any env file (template or not) holding a console-minted provider token.
  #    This is the rule that would have caught two live Railway project tokens
  #    pasted into the tracked root template .env.dev.example as
  #    railway_toke_staging / railway_toke_staging_old: the key name matches no
  #    EXPO_PUBLIC_/NEXT_PUBLIC_ prefix and the shape was not in SECRET_VALUE_RE,
  #    so both the CI hygiene lane and the pre-commit hook passed it.
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    report "$f: env file holds a live provider token → ${line%%=*}"
  done < <(grep -nE "$TOKEN_SHAPE_RE" "$f" 2>/dev/null || true)
done

# 5) Tree-wide: no live provider token in ANY tracked file, and no tracked live
#    env snapshot. Both use git's own tracked-file walk, so node_modules and
#    gitignored scratch dirs never enter the scan.
if git rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    path="${hit%%:*}"
    skip=""
    for self in "${SELF_PATHS[@]}"; do
      [ "$path" = "$self" ] && skip=1
    done
    [ -n "$skip" ] && continue
    report "tracked file contains a live provider token → $path"
  done < <(git grep -IE "$TOKEN_SHAPE_RE" -- . 2>/dev/null || true)

  while IFS= read -r tracked; do
    [ -z "$tracked" ] && continue
    echo "$tracked" | grep -qE "$TEMPLATE_SUFFIX_RE" && continue
    report "tracked file is a live env snapshot, not a template → $tracked"
  done < <(git ls-files | grep -E "$ENV_SNAPSHOT_RE" 2>/dev/null || true)
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Secret-hygiene check FAILED. Secrets must live server-side only"
  echo "(backend/.env). See docs/ENV.md."
  exit 1
fi
echo "✓ client secret-hygiene check passed (${#ENV_FILES[@]} env file(s) scanned)"
