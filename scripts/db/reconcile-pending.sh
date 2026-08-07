#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Staged reconciliation executor for drifted Supabase migration history.
#
# The remote's migration-history table is out of sync with its actual schema:
# some "pending" migrations already ran (history lost the row) while others
# genuinely never applied. This script drives the reconciliation SAFELY:
#
#   * dry-run by default — mutates nothing without --yes
#   * classifies pending migrations (via classify-pending-migrations.sh)
#   * PHASE R: `migration repair --status applied` for already-applied ones
#   * PHASE A: apply genuinely-missing / seed migrations ONE AT A TIME, each in
#             its own transaction (ON_ERROR_STOP), repairing history after each.
#             A collision halts immediately for manual fix — never a big-bang.
#
# ALWAYS run against STAGING first (a fresh DB reset from ALL local migrations),
# validate, THEN prod. See docs/devops/cloud-migration-reconciliation-runbook.md
#
# Usage:
#   reconcile-pending.sh --db-url <URL> [--migrations DIR] [--dry-run]         # default: dry-run
#   reconcile-pending.sh --db-url <URL> --repair --yes                          # PHASE R only
#   reconcile-pending.sh --db-url <URL> --apply  --yes                          # PHASE A only
#   reconcile-pending.sh --db-url <URL> --apply-one <version> --yes             # single migration
#   reconcile-pending.sh --db-url <URL> --verify                                # post-checks
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DBURL=""; MIG="supabase/migrations"; MODE="dry-run"; YES=0; ONE=""
while [ $# -gt 0 ]; do case "$1" in
  --db-url) DBURL="$2"; shift 2;;
  --migrations) MIG="$2"; shift 2;;
  --dry-run) MODE="dry-run"; shift;;
  --repair) MODE="repair"; shift;;
  --apply) MODE="apply"; shift;;
  --apply-one) MODE="apply-one"; ONE="$2"; shift 2;;
  --verify) MODE="verify"; shift;;
  --yes) YES=1; shift;;
  *) echo "unknown arg: $1" >&2; exit 2;;
esac; done
[ -z "$DBURL" ] && { echo "ERROR: --db-url required" >&2; exit 2; }
guard(){ [ "$YES" = 1 ] || { echo "REFUSING to mutate without --yes (this is $MODE). Re-run with --yes." >&2; exit 3; }; }
sv(){ supabase migration repair --status "$1" "$2" --db-url "$DBURL" 2>&1 | grep -vE 'A new version|We recommend|Run supabase' ; }

# Fresh classification each run (read-only)
CLS="$(mktemp)"; bash "$HERE/classify-pending-migrations.sh" "$DBURL" "$MIG" > "$CLS" 2>/dev/null
APPLIED=$(awk -F'\t' '$2=="APPLIED"{print $1}' "$CLS")
MISSING=$(awk -F'\t' '$2=="MISSING"{print $1}' "$CLS")
REVIEW=$(awk -F'\t' '$2=="REVIEW"{print $1}' "$CLS")
cnt(){ printf '%s\n' "$1" | grep -c . ; }

echo "== target: …@${DBURL##*@} =="   # host only — never print credentials
echo "== pending buckets ==  APPLIED=$(cnt "$APPLIED")  MISSING=$(cnt "$MISSING")  REVIEW=$(cnt "$REVIEW")"

apply_one(){ # <version> : run its SQL in a txn, then mark applied
  local v="$1" f; f=$(ls "$MIG"/${v}_*.sql 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "  ! no file for $v"; return 1; }
  echo "  → apply $(basename "$f")"
  psql "$DBURL" -1 -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>>/tmp/reconcile_apply.err || {
    echo "  ✗ FAILED — see /tmp/reconcile_apply.err (migration rolled back). Halting."; return 1; }
  sv applied "$v" >/dev/null && echo "  ✓ applied + history recorded"
}

case "$MODE" in
  dry-run)
    echo; echo "PHASE R would repair→applied (already on remote):"; printf '%s\n' "$APPLIED" | sed 's/^/   /'
    echo; echo "PHASE A would apply (missing/seed), one-at-a-time:"; printf '%s\n' "$MISSING" | sed 's/^/   /'
    echo; echo "MANUAL REVIEW first (no auto sentinel — many are seed/RBAC):"; printf '%s\n' "$REVIEW" | sed 's/^/   /'
    echo; echo "(dry-run — nothing changed. Add --repair/--apply/--apply-one with --yes to execute.)";;
  repair)
    guard; echo; echo "PHASE R: marking already-applied migrations as applied…"
    for v in $APPLIED; do echo "  repair $v"; sv applied "$v" >/dev/null; done
    echo "done.";;
  apply)
    guard; : > /tmp/reconcile_apply.err
    echo; echo "PHASE A: applying MISSING migrations one at a time (halts on first error)…"
    for v in $MISSING; do apply_one "$v" || { echo "STOPPED at $v."; exit 1; }; done
    echo "PHASE A complete. REVIEW bucket still needs manual handling: $(cnt "$REVIEW") files.";;
  apply-one)
    guard; : > /tmp/reconcile_apply.err; apply_one "$ONE";;
  verify)
    echo; echo "== remaining pending after reconcile =="
    supabase migration list --db-url "$DBURL" 2>/dev/null \
      | awk -F'|' '$1 ~ /[0-9]{14}/ && $2 !~ /[0-9]/ {c++} END{print "  pending: " c+0}'
    ;;
esac
rm -f "$CLS"
