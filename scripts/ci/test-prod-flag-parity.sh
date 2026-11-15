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
bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1 \
  || { echo "FAIL: declared=false must be accepted"; exit 1; }
grep -q 'prod-flag-parity ✓ — 1 flags declared (0 on, 1 off)' "$TMP/out" \
  || { echo "FAIL: declared=false did not produce the on/off summary"; exit 1; }

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

# 5 — a name carrying a regex metacharacter must be refused, not matched with.
# `^FEATURE.A=(true|false)$` would happily match FEATURE_XA, so an undeclared
# gate could false-pass; the guard is by NAME, not by pattern.
printf 'FEATURE_A_ENABLED=true\nFEATURE_XA_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\nFEATURE.A_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: metacharacter name went undetected"; exit 1; fi
# Anchored on the gate-surface leg's own wording, the file the name came from,
# and the offending literal — so this cannot be satisfied by the flag-file leg.
grep -qE "BAD gate name in $TMP/live.txt: 'FEATURE\.A_ENABLED'" "$TMP/out" \
  || { echo "FAIL: metacharacter gate name not named with its source"; exit 1; }

# 6 — a missing accessor source must fail with the guard's own reason, not with
# grep's: the pre-fix script printed "grep: …: No such file or directory" and
# exited 2, which mentions the filename but proves nothing about parity.
printf 'FEATURE_A_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
rc=0; bash "$CHECK" --file "$TMP/config/production-module-flags.env" --flags "$TMP/no-such.ts" > "$TMP/out" 2>&1 || rc=$?
[ "$rc" -eq 1 ] || { echo "FAIL: missing accessor source exited $rc, expected 1"; exit 1; }
grep -q 'cannot be derived' "$TMP/out" \
  || { echo "FAIL: missing accessor source not named by the guard"; exit 1; }

# 7 — the same refusal on the flag-file leg: a key that is not [A-Z0-9_]+
# cannot be tested for membership in the gate surface, so it is drift, not a
# silent grep.
printf 'FEATURE_A_ENABLED=true\nFEATURE.A_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
rc=0; bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1 || rc=$?
[ "$rc" -eq 1 ] || { echo "FAIL: bad flag-file key exited $rc, expected 1"; exit 1; }
grep -q 'cannot be matched against the gate surface' "$TMP/out" \
  || { echo "FAIL: bad flag-file key not named"; exit 1; }

# 8 — an accessor source that exists but declares no gate: the derivation
# grep exits 1, and under pipefail that would end the run with no line at all.
printf 'export const nothingToRead = 1\n' > "$TMP/no-gates.ts"
printf 'FEATURE_A_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
rc=0; bash "$CHECK" --file "$TMP/config/production-module-flags.env" --flags "$TMP/no-gates.ts" > "$TMP/out" 2>&1 || rc=$?
[ "$rc" -eq 1 ] || { echo "FAIL: zero-gate accessor source exited $rc, expected 1"; exit 1; }
grep -q 'gate surface is empty' "$TMP/out" \
  || { echo "FAIL: zero-gate accessor source not named"; exit 1; }

# 9 — the --live path must not require the accessor source file to exist. It
# names a plane, not the whole tree (Task 10 and Task 13 reconcile one plane at
# a time), so the $FLAGS guard belongs to the deriving branch only. Without
# this case, moving that guard back to the top level stays green in CI, where
# the checkout always provides frontend-web/.
( cd "$TMP" && bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" ) > "$TMP/out" 2>&1 \
  || { echo "FAIL: --live path demanded the accessor source"; sed -n '1,3p' "$TMP/out"; exit 1; }
grep -q 'prod-flag-parity ✓' "$TMP/out" \
  || { echo "FAIL: --live path did not report parity"; exit 1; }
echo "PASS"
