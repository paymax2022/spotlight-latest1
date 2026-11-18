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
# Sweep the tree through a nullglob array. Without it an unmatched or
# non-directory --migrations leaves the pattern literal, every per-file scan
# fails, and the run still exits 0 — which is how this script's predecessors
# turned a dead input into a green answer. bash 3.2 is the floor here (macOS),
# so the count is checked before the array is ever expanded.
[ -d "$MIG" ] || { echo "refusing: --migrations '$MIG' is not a directory" >&2; exit 2; }
shopt -s nullglob
files=("$MIG"/*.sql)
shopt -u nullglob
[ "${#files[@]}" -gt 0 ] || { echo "refusing: '$MIG' holds no .sql migration files" >&2; exit 2; }
for f in "${files[@]}"; do
  # An unreadable file is a refused scan, not a clean one: `|| true` below makes
  # sed's failure indistinguishable from zero destructive matches.
  [ -r "$f" ] || { echo "refusing: cannot read '$f'" >&2; exit 2; }
  v="$(basename "$f" | cut -d_ -f1)"
  # The -lt comparison below and the apply order both assume a 14-digit prefix;
  # a mis-named file would otherwise error mid-sweep or mis-sort silently.
  [[ "$v" =~ ^2[0-9]{13}$ ]] || { echo "refusing: '$(basename "$f")' has no 14-digit version prefix" >&2; exit 2; }
  grep -qx "$v" <(tr -d ' ' < "$REMOTE") && continue
  # Same vocabulary as .github/workflows/_reusable-migration-guard.yml:102-104 —
  # one source of truth for "destructive", plus SET NOT NULL (a narrowing CI's
  # regex cannot judge without seeing the data) and TRUNCATE. Comments are
  # stripped first so a header note about "no DROP TABLE" is not read as DDL.
  # NOTE: this is deliberately CI's vocabulary, not the prod writer's:
  # ops-db-push-scoped.yml:152 adds `alter table … drop`, so a file can read
  # `additive` here and still be refused by the lane. NON-ADDITIVE therefore
  # means "CI's own gate would have blocked this file", nothing more.
  # `|| true` is load-bearing twice over: grep exits 1 on a zero-match line and
  # `set -o pipefail` propagates that through `wc -l` into the assignment, which
  # under `set -e` would abort the sweep on the first clean migration.
  hits="$(sed -E 's/--.*$//' "$f" | grep -iE "$DESTRUCTIVE" | grep -ivE "$ALLOW" | wc -l | tr -d ' ' || true)"
  case "$hits" in
    ''|*[!0-9]*) echo "refusing: destructive count for '$f' is not a number ('$hits')" >&2; exit 2 ;;
  esac
  if [ "$hits" -gt 0 ]; then kind=NON-ADDITIVE; bad=$((bad + 1)); else kind=additive; fi
  pos=above-max; [ "$v" -lt "$max" ] && pos=below-max
  printf 'pending %s %s %s %s\n' "$v" "$(basename "$f")" "$pos" "$kind"
done
echo "-- remote max applied: $max | recorded: $(wc -l < "$REMOTE" | tr -d ' ')"
[ "$bad" -eq 0 ] || exit 1
