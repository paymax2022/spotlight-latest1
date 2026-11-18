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
#
# Run it from the repo root: the two defaults below are root-relative, which is
# how both call sites invoke it (Makefile `flag-parity`, and CI, where
# actions/checkout puts the workspace root as the step's cwd).
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
  # Guarded only on the deriving path: with --live the operator supplied the
  # names, so $FLAGS is message text and a missing tree must not refuse the run.
  [ -s "$FLAGS" ] || { echo "FAIL: $FLAGS missing or empty — the gate surface cannot be derived, so parity is unprovable"; exit 1; }
  LIVE_SRC="$FLAGS"
  # envFlag() only, on purpose. envFlagDefaultTrue('X') (feature-flags.ts:31-36)
  # returns true when X is unset, so an undeclared name there is served ON and
  # is not the 503 this guard exists to catch; adding it here would demand a
  # directive that changes no behaviour.
  # Probed before deriving, rather than papering over the pipeline with
  # `|| true`: one `|| true` cannot tell grep's exit 1 (zero matches — the case
  # worth naming) from exit >=2 (a read error we cannot interpret), and either
  # left a short gate list that could pass. The probe fails loudly on both.
  # The check after the pipeline catches the shape the probe cannot see: GNU
  # grep on binary input answers `-q` yes while `-o` emits nothing.
  grep -qE "envFlag\('[A-Z0-9_]+'\)" "$FLAGS" \
    || { echo "FAIL: no envFlag('NAME') accessor found in $FLAGS — the gate surface is empty, so parity is unprovable"; exit 1; }
  LIVE="$(mktemp)"; trap 'rm -f "$LIVE"' EXIT
  grep -oE "envFlag\('[A-Z0-9_]+'\)" "$FLAGS" | sed "s/envFlag('//;s/')//" | sort -u > "$LIVE"
  [ -s "$LIVE" ] || { echo "FAIL: $FLAGS answers envFlag('NAME') but yielded no usable name — the gate surface is unreadable, so parity is unprovable"; exit 1; }
else
  LIVE_SRC="$LIVE"
fi
drift=0
# Both name interpolations are guarded, not trusted: on the default path the
# derivation regex already constrains names to [A-Z0-9_], but --live and the
# flag file are caller-supplied text, and a metacharacter inside `^${name}=(…)`
# widens the match — which would report a genuinely undeclared gate as fine.
while read -r name || [ -n "$name" ]; do
  [ -n "$name" ] || continue
  case "$name" in
    *[!A-Z0-9_]*) echo "BAD gate name in $LIVE_SRC: '$name' (must be [A-Z0-9_]+ — a metacharacter here would widen the match and false-pass)"; drift=$((drift + 1)); continue ;;
  esac
  grep -qE "^${name}=(true|false)$" "$FILE" \
    || { echo "UNDECLARED in $FILE: $name (write =true to serve it, =false to refuse it)"; drift=$((drift + 1)); }
done < "$LIVE"
while read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  k="${line%%=*}"; v="${line#*=}"
  case "$k" in
    ''|*[!A-Z0-9_]*) echo "BAD name in $FILE: '$k' (must be [A-Z0-9_]+ — it cannot be matched against the gate surface)"; drift=$((drift + 1)); continue ;;
  esac
  grep -qx "$k" "$LIVE" || { echo "DEAD wiring: $k is declared but $LIVE_SRC never reads it"; drift=$((drift + 1)); }
  [ "$v" = "true" ] || [ "$v" = "false" ] || { echo "BAD value for $k: '$v' (must be true or false)"; drift=$((drift + 1)); }
done < "$FILE"
[ "$drift" -eq 0 ] || { echo "prod-flag-parity ✗ — $drift drift(s)"; exit 1; }
# `|| true` is load-bearing: grep -c exits 1 when it counts zero, and under
# `set -e` that kills the script mid-summary with no output at all.
on=$(grep -cE '^[A-Z0-9_]+=true$' "$FILE" || true)
off=$(grep -cE '^[A-Z0-9_]+=false$' "$FILE" || true)
echo "prod-flag-parity ✓ — $((on + off)) flags declared ($on on, $off off)"
