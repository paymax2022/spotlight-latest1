#!/usr/bin/env bash
# Fail when a feature gate the web BFF reads is not DECLARED in the committed
# production flag file, or when the file declares a name the code never reads.
# Rationale: feature-flags.ts gates are strict `process.env[X] === 'true'` reads,
# so a name production never declares is a silent 503 on the public site — the
# referral-gate-parity runbook class, caught in CI instead of by a user.
#
# Declared means `KEY=true` (serve it) or `KEY=false` (deliberately don't). Both
# behave identically to an unset var at runtime; the difference is that false is
# a recorded decision and absence is an accident waiting to be argued about.
#
# --live overrides the derived name list (one name per line) when reconciling a
# specific plane instead of the whole codebase.
set -euo pipefail
FILE="frontend-web/config/production-module-flags.env"
FLAGS="frontend-web/src/lib/feature-flags.ts"
LIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --flags) FLAGS="$2"; shift 2 ;;
    --live) LIVE="$2"; shift 2 ;;
    *) echo "usage: check-prod-flag-parity.sh [--file F] [--flags TS] [--live NAMES]" >&2; exit 2 ;;
  esac
done
[ -s "$FILE" ] || { echo "FAIL: $FILE missing or empty — production would carry zero FEATURE_*"; exit 1; }
if [ -z "$LIVE" ]; then
  LIVE="$(mktemp)"; trap 'rm -f "$LIVE"' EXIT
  # envFlag() only, on purpose. envFlagDefaultTrue('X') (feature-flags.ts:31-36)
  # returns true when X is unset, so an undeclared name there is served ON and
  # is not the 503 this guard exists to catch; adding it here would demand a
  # directive that changes no behaviour.
  grep -oE "envFlag\('[A-Z0-9_]+'\)" "$FLAGS" | sed "s/envFlag('//;s/')//" | sort -u > "$LIVE"
fi
drift=0
while read -r name || [ -n "$name" ]; do
  [ -n "$name" ] || continue
  grep -qE "^${name}=(true|false)$" "$FILE" \
    || { echo "UNDECLARED in $FILE: $name (write =true to serve it, =false to refuse it)"; drift=$((drift + 1)); }
done < "$LIVE"
while read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  k="${line%%=*}"; v="${line#*=}"
  grep -qx "$k" "$LIVE" || { echo "DEAD wiring: $k is declared but $FLAGS never reads it"; drift=$((drift + 1)); }
  [ "$v" = "true" ] || [ "$v" = "false" ] || { echo "BAD value for $k: '$v' (must be true or false)"; drift=$((drift + 1)); }
done < "$FILE"
[ "$drift" -eq 0 ] || { echo "prod-flag-parity ✗ — $drift drift(s)"; exit 1; }
# `|| true` is load-bearing: grep -c exits 1 when it counts zero, and under
# `set -e` that kills the script mid-summary with no output at all.
on=$(grep -cE '^[A-Z0-9_]+=true$' "$FILE" || true)
off=$(grep -cE '^[A-Z0-9_]+=false$' "$FILE" || true)
echo "prod-flag-parity ✓ — $((on + off)) flags declared ($on on, $off off)"
