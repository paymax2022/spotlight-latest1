#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/db -> repo root
LIST="$ROOT/scripts/db/list-pending.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
MIG="$TMP/supabase/migrations"; mkdir -p "$MIG"
printf 'CREATE TABLE a (id int);\n'             > "$MIG/20270000000001_one.sql"
printf 'DROP TABLE b;\n'                        > "$MIG/20270000000002_drop.sql"
printf 'ALTER TABLE c ALTER COLUMN d SET NOT NULL;\n' > "$MIG/20270000000003_narrow.sql"
printf 'CREATE TABLE z (id int);\n'             > "$MIG/20260101000000_backdated.sql"
printf '20270000000001\n' > "$TMP/applied.txt"
# `|| true` is load-bearing: the classifier exits 1 on this very fixture (a
# NON-ADDITIVE row exists), and under `set -e` a failing command substitution
# would abort the test before it asserts anything.
out="$(bash "$LIST" --remote "$TMP/applied.txt" --migrations "$MIG" || true)"

echo "$out" | grep -q '^pending 20270000000002 .* NON-ADDITIVE' || { echo "FAIL: drop not flagged"; exit 1; }
echo "$out" | grep -q '^pending 20270000000003 .* NON-ADDITIVE' || { echo "FAIL: SET NOT NULL not flagged"; exit 1; }
echo "$out" | grep -q '^pending 20260101000000 .* below-max'    || { echo "FAIL: back-dated not marked"; exit 1; }
echo "$out" | grep -q '^pending 20270000000001' && { echo "FAIL: applied version listed"; exit 1; }
if bash "$LIST" --remote "$TMP/applied.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: must exit non-zero when a NON-ADDITIVE row is present"; exit 1
fi
# An empty remote list is refused rather than read as "everything is pending".
: > "$TMP/empty.txt"
if bash "$LIST" --remote "$TMP/empty.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: empty remote list must be refused"; exit 1
fi
# --remote-table reads the CLI's own table. The 20270000000002 row is LOCAL-ONLY
# (Remote padded with a space between backticks), so it must still come back as
# pending; sweeping every 14-digit run instead calls it applied and hides it.
cat > "$TMP/table.txt" <<'TBL'
 Local            | Remote           | Time (UTC)
------------------|------------------|-----------------------
 `20260101000000` | `20260101000000` | `2026-01-01 00:00:00`
 `20270000000002` | ` `              | `2027-01-01 00:00:00`
 `20270000000003` | `20270000000003` | `2026-01-01 00:00:00`
TBL
tout="$(bash "$LIST" --remote-table "$TMP/table.txt" --migrations "$MIG" || true)"
echo "$tout" | grep -q '^pending 20270000000002 .* NON-ADDITIVE' || { echo "FAIL: local-only row must stay pending"; exit 1; }
# The table's max applied is ...0003, so ...0001 and ...0002 are below-max: the
# hazard that makes a bare `db push` apply nothing.
echo "$tout" | grep -q '^pending 20270000000001 .* below-max additive' || { echo "FAIL: absent-from-table row must be pending below-max"; exit 1; }
echo "$tout" | grep -q '^pending 20260101000000' && { echo "FAIL: table row with a Remote value listed"; exit 1; }
echo "$tout" | grep -q '^pending 20270000000003' && { echo "FAIL: table row with a Remote value listed"; exit 1; }
echo "$tout" | grep -q 'recorded: 2' || { echo "FAIL: --remote-table must record 2 applied versions"; exit 1; }
# A table with no applied rows is refused, not read as "nothing is applied".
printf ' Local            | Remote           | Time (UTC)\n `20270000000001` | ` ` | `x`\n' > "$TMP/none.txt"
if bash "$LIST" --remote-table "$TMP/none.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: all-local-only table must be refused"; exit 1
fi
# Malformed --remote input is refused too — a typo here silently mis-orders prod.
printf '2027-01-01\n' > "$TMP/bad.txt"
if bash "$LIST" --remote "$TMP/bad.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: malformed remote line must be refused"; exit 1
fi
echo "PASS"
