#!/usr/bin/env bash
# list-pending.sh — which committed migrations are NOT recorded in a remote's
# history table, in apply order, each tagged for the two hazards that bit this
# repo: files that sort BELOW the remote's max applied version (a bare
# `supabase db push` silently applies nothing when any exist) and files that are
# not additive-only. Read-only: it never touches a database.
set -euo pipefail
REMOTE=""; TABLE=""; MIG="supabase/migrations"
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    --remote-table) TABLE="$2"; shift 2 ;;
    --migrations) MIG="$2"; shift 2 ;;
    *) echo "usage: list-pending.sh (--remote <versions.txt> | --remote-table <list-log.txt>) [--migrations <dir>]" >&2; exit 2 ;;
  esac
done
[ -n "$REMOTE" ] || [ -n "$TABLE" ] || { echo "refusing: no remote state given" >&2; exit 2; }
[ -n "$REMOTE" ] && [ -n "$TABLE" ] && { echo "refusing: --remote and --remote-table are alternatives" >&2; exit 2; }
if [ -n "$TABLE" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  # Column 2 only. A LOCAL-ONLY row pads Remote with a space between backticks,
  # so sweeping every 14-digit run instead counts pending versions as applied.
  awk -F'|' '/`20[0-9]{12}`[ ]*\|/ { v = $2; gsub(/[` ]/, "", v); if (v ~ /^20[0-9]{12}$/) print v }' \
    "$TABLE" | sort -u > "$TMP/remote.txt"
  REMOTE="$TMP/remote.txt"
fi
[ -s "$REMOTE" ] || { echo "refusing: remote version list is missing or empty" >&2; exit 2; }
grep -qvE '^ *[0-9]{14} *$' "$REMOTE" && { echo "refusing: remote list holds a non-14-digit line" >&2; exit 2; }
max="$(tr -d ' ' < "$REMOTE" | sort | tail -1)"
DESTRUCTIVE='drop[[:space:]]+(table|column|type|schema|database|domain|sequence)|truncate[[:space:]]|alter[[:space:]]+[a-z0-9_."]+[[:space:]]+drop|rename[[:space:]]+(column|to)|set[[:space:]]+not[[:space:]]+null'
ALLOW='drop[[:space:]]+(policy|trigger|index|function|view|materialized[[:space:]]+view|publication|rule)[[:space:]]+if[[:space:]]+exists'
bad=0
for f in "$MIG"/*.sql; do
  v="$(basename "$f" | cut -d_ -f1)"
  grep -qx "$v" "$REMOTE" && continue
  # Same vocabulary as .github/workflows/_reusable-migration-guard.yml:102-104 —
  # one source of truth for "destructive", plus SET NOT NULL (a narrowing CI's
  # regex cannot judge without seeing the data) and TRUNCATE. Comments are
  # stripped first so a header note about "no DROP TABLE" is not read as DDL.
  # `|| true` is load-bearing twice over: grep exits 1 on a zero-match line and
  # `set -o pipefail` propagates that through `wc -l` into the assignment, which
  # under `set -e` would abort the sweep on the first clean migration.
  hits="$(sed -E 's/--.*$//' "$f" | grep -iE "$DESTRUCTIVE" | grep -ivE "$ALLOW" | wc -l | tr -d ' ' || true)"
  if [ "$hits" -gt 0 ]; then kind=NON-ADDITIVE; bad=$((bad + 1)); else kind=additive; fi
  pos=above-max; [ "$v" -lt "$max" ] && pos=below-max
  printf 'pending %s %s %s %s\n' "$v" "$(basename "$f")" "$pos" "$kind"
done
echo "-- remote max applied: $max | recorded: $(wc -l < "$REMOTE" | tr -d ' ')"
[ "$bad" -eq 0 ] || exit 1
