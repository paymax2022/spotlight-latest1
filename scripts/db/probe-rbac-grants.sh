#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Read-only RBAC grant probe.
#
# WHY THIS EXISTS. The RBAC seeds in supabase/migrations grant permissions with
# slug-keyed `INSERT … SELECT`:
#
#     INSERT INTO role_permissions SELECT r.id, p.id FROM … WHERE r.slug IN (…)
#
# If the referenced role row is absent, that statement matches nothing, the
# transaction still commits, and `supabase_migrations.schema_migrations` books
# the version as applied. The ledger says "applied"; the grants do not exist. A
# scoped admin then gets 403 with no signal anywhere. This probe closes that gap
# by verifying the RESULT of the seed rather than its history row.
#
# CONTRACT. Strictly read-only. Every statement runs in a session with
# `default_transaction_read_only=on`, so a write is refused by Postgres itself,
# and the enforcement-path sample is only called after `pg_proc.provolatile`
# says the function is STABLE or IMMUTABLE (a VOLATILE function cannot execute
# in a read-only transaction anyway — two independent guards).
#
# Expectation syntax (one or more, whitespace/newline separated; roles are
# comma separated). Slugs and roles are matched against a whitelist BEFORE they
# reach SQL — they are interpolated into literals, so anything outside the
# whitelist is a usage error, not a query.
#
#     <permission-slug>                       the row must exist
#     <permission-slug>=<role>,<role>,…       each role must hold it
#
# Usage:
#   probe-rbac-grants.sh --db-url <URL> [--mode plan|apply] --expect '<…>' [--expect '<…>']
#
# Exit codes — deliberately distinguishable for the operator:
#   0  every assertion holds, OR findings reported in plan mode (informational)
#   1  at least one assertion failed in apply mode
#   2  arguments refused (nothing was queried)
#   3  the database could not be reached or read (NOT a verdict about the grants)
#
#   --mode plan   findings print and exit 0  — use before applying a seed
#   --mode apply  findings are a hard failure — use after applying a seed
#
# Never point this at anything you have not authorised; --db-url is required and
# DATABASE_URL (the production pooler in CI) is deliberately never consulted.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DBURL=""; MODE=""; EXPECTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --db-url|--mode|--expect)
      [ $# -ge 2 ] || { echo "ERROR: $1 requires a value" >&2; exit 2; }
      case "$1" in
        --db-url) DBURL="$2";;
        --mode)   MODE="$2";;
        --expect) EXPECTS+=("$2");;
      esac
      shift 2;;
    *) echo "ERROR: unknown arg: $1" >&2; exit 2;;
  esac
done
die() { echo "ERROR: $*" >&2; exit 2; }
die3() { echo "ERROR: $*" >&2; exit 3; }

[ -n "$DBURL" ] || die "--db-url is required (the probe never reads DATABASE_URL)"
[ -n "$MODE" ] || MODE="plan"
case "$MODE" in plan|apply) ;; *) die "unknown --mode: '$MODE' (expected plan or apply)";; esac

SLUG_RE='^[a-z0-9][a-z0-9_.:-]{0,63}$'
ROLE_RE='^[a-z0-9][a-z0-9_-]{0,63}$'
MAX_EXPECT=20

# Tokenise: unquoted expansion splits on spaces, tabs and newlines alike, so the
# workflow can pass a multi-line `rbac_expect` verbatim.
TOKENS=""
for e in ${EXPECTS[@]+"${EXPECTS[@]}"}; do TOKENS="$TOKENS $e"; done

SLUGS=(); ROLELISTS=()
for t in $TOKENS; do
  # `has_eq` is tracked separately from `roles` being empty: 'slug=' is a typo
  # for a role list, not a request to check only the row. Reading it as the
  # latter would report green on a run that asserted nothing about the grants.
  has_eq=0
  case "$t" in
    *=*=*) die "malformed expectation '$t': a second '=' is not supported";;
    *=*)   has_eq=1; s="${t%%=*}"; roles="${t#*=}";;
    *)     s="$t"; roles="";;
  esac
  printf '%s\n' "$s" | grep -Eq "$SLUG_RE" \
    || die "invalid permission slug in expectation '$t' (allowed: $SLUG_RE)"
  clean=""
  if [ -n "$roles" ]; then
    IFS=',' read -ra parts <<< "$roles"
    for r in ${parts[@]+"${parts[@]}"}; do
      printf '%s\n' "$r" | grep -Eq "$ROLE_RE" \
        || die "invalid role slug in expectation '$t' (allowed: $ROLE_RE)"
      clean="$clean $r"
    done
  fi
  if [ "$has_eq" = 1 ] && [ -z "$clean" ]; then
    die "expectation '$t' names no roles — drop the '=' to assert the row alone, or list at least one role"
  fi
  SLUGS+=("$s"); ROLELISTS+=("$clean")
done

[ ${#SLUGS[@]} -gt 0 ] || die "rbac_expect holds nothing to check — a probe that verifies nothing must not report green"
[ ${#SLUGS[@]} -le "$MAX_EXPECT" ] || die "too many expectations: ${#SLUGS[@]} > $MAX_EXPECT"

# ── connect, read-only by construction ───────────────────────────────────────
PGOPTIONS='-c default_transaction_read_only=on'; export PGOPTIONS
q() { psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -At -c "$1"; }

rest="${DBURL#*://}"; creds="${rest%%@*}"; hostdb="${rest#*@}"
echo "RBAC grant probe — read-only, mode=$MODE, ${#SLUGS[@]} expectation(s)"
echo "  target: ${creds%%:*}@${hostdb%%\?*}"
q 'SELECT 1' >/dev/null 2>&1 || die3 "cannot reach the database at ${creds%%:*}@${hostdb%%\?*} — nothing has been concluded about the grants"
# Enforced, not assumed: PGOPTIONS above is the only reason this session cannot
# write, so confirm the server agrees before any statement is called a check.
ro="$(q 'SHOW default_transaction_read_only')" || die3 "the session's read-only posture could not be read"
[ "$ro" = on ] || die3 "this session is not read-only (default_transaction_read_only=$ro) — refusing to probe, nothing has been concluded"
echo "  session: read-only (default_transaction_read_only=$ro)"

# ── 1. permission rows, expected role grants, and the actual holder list ─────
# One round-trip: every expectation contributes rows, tagged with its index.
sql=""
i=0
while [ $i -lt ${#SLUGS[@]} ]; do
  s="${SLUGS[$i]}"
  add() { [ -z "$sql" ] && sql="$1" || sql="$sql
UNION ALL
$1"; }
  add "SELECT 'perm|$i|' || count(*)::text || '|' || COALESCE(bool_or(is_system_permission)::text,'-') || '|$s' FROM public.permissions WHERE slug = '$s'"
  add "SELECT 'holders|$i|' || COALESCE(string_agg(r.slug, ', ' ORDER BY r.slug),'') FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id JOIN public.permissions p ON p.id = rp.permission_id WHERE p.slug = '$s'"
  for r in ${ROLELISTS[$i]}; do
    add "SELECT 'grant|$i|$r|' || count(*)::text FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id JOIN public.permissions p ON p.id = rp.permission_id WHERE p.slug = '$s' AND r.slug = '$r'"
  done
  i=$((i+1))
done
rows="$(q "$sql")" || die3 "the RBAC tables could not be read (missing relation?) — nothing has been concluded about the grants"

FAILED=0; CHECKED=0
GRANTED_ROLES_IDX=(); GRANTED_ROLES_R=()   # pairs whose grant exists -> sampled
while IFS='|' read -r kind idx a b rest_of_line; do
  case "$kind" in
    perm)
      printf '  permission row: '
      if [ "${a:-0}" = 0 ]; then
        printf 'MISSING  %s — the seed booked its history row without inserting this permission\n' "$rest_of_line"
        FAILED=$((FAILED+1))
      else
        printf 'present  %s (is_system_permission=%s)\n' "$rest_of_line" "$b"
        # The seed writes is_system_permission = true with ON CONFLICT DO NOTHING,
        # so a row that disagrees predates it: the seed was a no-op on this row
        # and something else owns it. Worth a finding, not silence.
        if [ "${b:-}" != true ]; then
          printf '  flag: FINDING  %s is_system_permission=%s, expected true from the seed\n' "$rest_of_line" "${b:-null}"
          FAILED=$((FAILED+1))
        fi
      fi
      CHECKED=$((CHECKED+1))
      ;;
    grant)
      printf '  grant: '
      if [ "${b:-0}" = 0 ]; then
        printf 'MISSING  %s -> %s\n' "$a" "${SLUGS[$idx]}"
        FAILED=$((FAILED+1))
      else
        printf 'GRANTED  %s -> %s\n' "$a" "${SLUGS[$idx]}"
        GRANTED_ROLES_IDX+=("$idx"); GRANTED_ROLES_R+=("$a")
      fi
      CHECKED=$((CHECKED+1))
      ;;
    holders)
      if [ -z "${a:-}" ]; then
        printf '  holders: none for %s\n' "${SLUGS[$idx]}"
      else
        printf '  holders: %s\n' "$a"
      fi
      ;;
  esac
done <<< "$rows"

# ── 2. enforcement path: ask the same RPC the middleware asks ────────────────
# The grant rows prove the seed; the RPC proves the API guard will actually pass.
# Only pairs that are GRANTED are sampled — a missing grant would just restate
# the finding above. Candidates are narrowed to assignments that
# effective_permissions itself would honour (active role + active, unexpired,
# unstarted-in-the-future, global assignment, no global DENY override), so the
# sample can report a real anomaly instead of an unrelated per-user exception.
vol="$(q "SELECT COALESCE((SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'user_has_permission' AND p.pronargs = 4), 'x')")" \
  || die3 "the RPC definition could not be read"
if [ "$vol" != s ] && [ "$vol" != i ]; then
  echo "  rpc: SKIPPED  public.user_has_permission(provolatile=${vol}) is not STABLE/IMMUTABLE — calling it could write, so the enforcement path is unverified (informational, not a finding)"
elif [ ${#GRANTED_ROLES_IDX[@]} -gt 0 ]; then
  sql=""
  j=0
  while [ $j -lt ${#GRANTED_ROLES_IDX[@]} ]; do
    idx="${GRANTED_ROLES_IDX[$j]}"; r="${GRANTED_ROLES_R[$j]}"; s="${SLUGS[$idx]}"
    # One row per expectation: the sampled holder plus how many were eligible.
    # Candidates are narrowed exactly the way effective_permissions narrows them,
    # so the sample reports a real anomaly instead of an unrelated exception; a
    # super-admin holder is last because its answer comes from the bypass.
    # One row per expectation: the sampled holder plus how many were eligible.
    # Candidates are narrowed exactly the way effective_permissions narrows them,
    # so the sample reports a real anomaly instead of an unrelated per-user
    # exception. count(*) OVER () sees every eligible row before LIMIT 1 picks
    # one, so the operator learns whether the sample is one of many or alone; a
    # super-admin holder sorts last because its answer comes from the bypass.
    # A WITH clause cannot be a UNION ALL branch, hence the nested subqueries.
    cand="SELECT 'rpc|$idx|$r|' || x.u::text || '|' || public.user_has_permission(x.u, '$s')::text || '|' || x.bypass::text || '|' || x.n::text
FROM (
  SELECT u, bypass, made, n FROM (
    SELECT ur.user_id AS u, ur.created_at AS made, count(*) OVER () AS n,
           EXISTS (SELECT 1 FROM public.user_roles su JOIN public.roles sr ON sr.id = su.role_id
                    WHERE su.user_id = ur.user_id AND sr.slug = 'super-admin' AND sr.is_active = true
                      AND su.is_active = true AND (su.expires_at IS NULL OR su.expires_at > now())) AS bypass
    FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
    WHERE r.slug = '$r' AND ur.scope_type = 'global' AND ur.is_active = true AND r.is_active = true
      AND (ur.starts_at IS NULL OR ur.starts_at <= now())
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions up JOIN public.permissions pp ON pp.id = up.permission_id
                       WHERE up.user_id = ur.user_id AND pp.slug = '$s' AND up.effect = 'deny'
                         AND (up.expires_at IS NULL OR up.expires_at > now())
                         AND up.scope_type = 'global')
  ) pool
  ORDER BY bypass, made
  LIMIT 1
) x"
    [ -z "$sql" ] && sql="$cand" || sql="$sql
UNION ALL
$cand"
    j=$((j+1))
  done
  rpcrows="$(q "$sql")" || die3 "the enforcement-path sample could not be read"

  sampled=""
  j=0
  while [ $j -lt ${#GRANTED_ROLES_IDX[@]} ]; do
    idx="${GRANTED_ROLES_IDX[$j]}"; r="${GRANTED_ROLES_R[$j]}"; s="${SLUGS[$idx]}"
    line="$(printf '%s\n' "$rpcrows" | grep "|$idx|$r|" | head -1)"
    if [ -z "$line" ]; then
      printf '  rpc: no eligible holder for %s (no active, unexpired, global assignment to sample — informational)\n' "$r"
    else
      IFS='|' read -r _k _i _r uid res bypass n _x <<< "$line"
      via='the role grant'
      [ "${bypass:-f}" = t ] && via='the super-admin bypass, so this proves wiring only'
      plural='s'; [ "${n:-1}" = 1 ] && plural=''
      tail="…${uid: -4}"        # a CI log must not carry a whole user id
      if [ "${res:-}" = true ]; then
        printf '  rpc: OK  %s -> %s (1 of %s eligible holder%s, sample %s holds the role, resolved via %s)\n' "$r" "$s" "${n:-?}" "$plural" "$tail" "$via"
      else
        printf '  rpc: MISMATCH  %s -> %s (1 of %s eligible holder%s, sample %s holds the role but the RPC returns false)\n' "$r" "$s" "${n:-?}" "$plural" "$tail"
        FAILED=$((FAILED+1)); CHECKED=$((CHECKED+1))
      fi
      sampled="${sampled} $r"
    fi
    j=$((j+1))
  done
fi

# ── 3. verdict ────────────────────────────────────────────────────────────────
if [ "$MODE" = apply ]; then
  if [ "$FAILED" -gt 0 ]; then
    echo "FAIL: $FAILED of $CHECKED RBAC assertions do not hold — the grants are not live even though history may say otherwise"
    exit 1
  fi
  echo "OK: all $CHECKED RBAC assertions hold (permission rows present, expected roles granted, sampled holders resolve the permission)"
  exit 0
fi
if [ "$FAILED" -gt 0 ]; then
  echo "WARNING (plan mode, not blocking): $FAILED of $CHECKED RBAC assertions do not hold — expected before a seed applies, and the reason to re-check after"
fi
echo "OK: probe completed in plan mode — $CHECKED assertion(s) checked, findings above are informational"
