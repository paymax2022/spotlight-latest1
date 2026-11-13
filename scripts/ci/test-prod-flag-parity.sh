#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/check-prod-flag-parity.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/config"

# 1 — a gated name the file never declares must fail and name the offender.
printf 'FEATURE_A_ENABLED=true\nFEATURE_B_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\nFEATURE_B_ENABLED\nFEATURE_C_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: undeclared flag went undetected"; exit 1; fi
grep -q 'FEATURE_C_ENABLED' "$TMP/out" || { echo "FAIL: undeclared flag not named"; exit 1; }

# 2 — an explicitly declared OFF name is a decision, not drift.
printf 'FEATURE_A_ENABLED=false\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" >/dev/null \
  || { echo "FAIL: declared=false must be accepted"; exit 1; }

# 3 — a name the code does not read is dead wiring.
printf 'FEATURE_A_ENABLED=true\nFEATURE_DEAD_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: dead wiring went undetected"; exit 1; fi
grep -q 'FEATURE_DEAD_ENABLED' "$TMP/out" || { echo "FAIL: dead wiring not named"; exit 1; }

# 4 — a value that is neither true nor false is not a flag, it is a typo.
printf 'FEATURE_A_ENABLED=1\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: bad value went undetected"; exit 1; fi
grep -q 'BAD value' "$TMP/out" || { echo "FAIL: bad value not named"; exit 1; }
echo "PASS"
