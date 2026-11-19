#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/db -> repo root
PROBE="$ROOT/scripts/db/probe-rbac-grants.sh"
SEED="$ROOT/supabase/migrations/20271700000000_connect_contests_view_rbac_seed.sql"
SLUG='connect.contests.view'
EXPECT="$SLUG=super-admin,system-admin,contest-manager"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
# rc/out are set by `run`; `|| true` in the substitution is load-bearing because
# most of the cases below assert on a NON-zero exit, and under `set -e` a bare
# failing command substitution aborts the test before it can assert anything.
run() { rc=0; out="$("$@" 2>&1)" || rc=$?; }

# ── live-DB gate ──────────────────────────────────────────────────────────────
# TEST_DATABASE_URL only, never DATABASE_URL: the latter is the production
# pooler in CI (see CLAUDE.md). Without a URL the argument-validation cases
# still run; the DB cases are announced as skipped rather than passing silently.
if [ -n "${TEST_DATABASE_URL:-}" ]; then LIVE=1; else LIVE=0; fi
psql_fixture() { psql "$TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# ── 1. the script exists and is a strictly-read-only DB client ────────────────
[ -f "$PROBE" ] || fail "probe script missing"
grep -qE "^PGOPTIONS=.*default_transaction_read_only=on" "$PROBE" \
  || fail "probe must export default_transaction_read_only=on in PGOPTIONS (anchored: a comment is not enforcement)"
grep -qE '^q\(\)[[:space:]]*\{[[:space:]]*psql .*-c "BEGIN READ ONLY; .*ROLLBACK"' "$PROBE" \
  || fail "probe's q() must run every statement inside BEGIN READ ONLY … ROLLBACK — PGOPTIONS is a startup-parameter REQUEST, and a pooler that drops it (measured on the production session pooler, run 44478529252) leaves the read-only guarantee with nothing behind it"
grep -qE 'SHOW transaction_read_only' "$PROBE" \
  || fail "probe must read transaction_read_only from inside its own transaction: the per-transaction GUC is what proves the wrapper took effect, whereas the session GUC only reports what the client asked for"
grep -qE '^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b' "$PROBE" \
  && fail "probe source contains a write statement outside the read-only guard"

# ── 2. argument validation (no DB needed; hard error in BOTH modes) ───────────
for mode in plan apply; do
  # --db-url is mandatory.
  run bash "$PROBE" --mode "$mode" --expect "$EXPECT"
  [ "$rc" -eq 2 ] || fail "missing --db-url must be refused with 2, got $rc ($mode)"

  # A slug carrying anything outside the whitelist is refused rather than
  # interpolated: the token goes straight into a SQL literal.
  for bad in "Connect.Contests.View=super-admin" "$SLUG;DROP TABLE roles=super-admin" \
             "a'b=super-admin" "$SLUG=Super Admin" "$SLUG=role;--" "$SLUG=" "=x" "$SLUG=$SLUG=$SLUG"; do
    run bash "$PROBE" --db-url "postgres://n:n@127.0.0.1:1/none" --mode "$mode" --expect "$bad"
    [ "$rc" -eq 2 ] || fail "malformed expectation must be refused with 2 before any query: [$bad] ($mode, got $rc)"
  done

  # Empty input must not read as green: a verification tool that checks nothing
  # is the exact failure mode this probe exists to replace.
  for empty in "" "   " "
"; do
    run bash "$PROBE" --db-url "postgres://n:n@127.0.0.1:1/none" --mode "$mode" --expect "$empty"
    [ "$rc" -eq 2 ] || fail "empty rbac_expect must be refused with 2, got $rc ($mode)"
  done

  # Unbounded expectations would be an unbounded number of round-trips.
  many=""
  for i in $(seq 1 21); do many="$many a$i=b$i"; done
  run bash "$PROBE" --db-url "postgres://n:n@127.0.0.1:1/none" --mode "$mode" --expect "$many"
  [ "$rc" -eq 2 ] || fail "more than 20 expectations must be refused with 2, got $rc ($mode)"

  # --mode is a closed set: a typo must not quietly downgrade apply to plan.
  run bash "$PROBE" --db-url "postgres://n:n@127.0.0.1:1/none" --mode aply --expect "$EXPECT"
  [ "$rc" -eq 2 ] || fail "unknown --mode must be refused with 2, got $rc"

  # DATABASE_URL must never be consulted implicitly.
  run env DATABASE_URL="postgres://n:n@127.0.0.1:1/none" bash "$PROBE" --mode "$mode" --expect "$EXPECT"
  [ "$rc" -eq 2 ] || fail "probe must require --db-url, not fall back to DATABASE_URL (got $rc)"
done

# The slug and role tokens reach SQL as literals, so the whitelist is the only
# thing between a typo and a statement. Relaxed, this token edits the WHERE
# clause instead of being refused: the exit code must be 2 (refused, never
# connected) and the permission row must survive the attempt.
inj="connect.contests.view' or '1'='1"
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$inj"
[ "$rc" -eq 2 ] || fail "an injection-shaped slug must be refused with 2, got $rc: $out"

[ "$LIVE" -eq 1 ] || { echo "note: TEST_DATABASE_URL unset — argument cases only, 0 DB cases run"; echo "PASS (partial: no live DB)"; exit 0; }

# ── fixture ownership ─────────────────────────────────────────────────────────
# Everything below runs against an isolated throwaway Postgres that carries the
# RBAC plane but NOT the seed. Cleanup restores that exact state so the harness
# is re-runnable and leaves no residue for the next verification.
# Every fixture user this harness creates shares one email prefix, so
# cleanup cannot miss a later one: a leftover holder reads as a real eligible
# holder and skews the counts asserted in §9.
FIX_PREFIX='probe-rbac-grants-test'
FIX_USERS="${FIX_PREFIX}@spotlight.local"
FIX_USERS2="${FIX_PREFIX}2@spotlight.local"
FIX_ID2='00000000-0000-0000-0000-0000000000a2'
cleanup() {
  psql_fixture -c "
    DELETE FROM public.user_permissions WHERE user_id IN (SELECT id FROM public.platform_users WHERE email LIKE '${FIX_PREFIX}%');
    DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM public.platform_users WHERE email LIKE '${FIX_PREFIX}%');
    DELETE FROM public.platform_users WHERE email LIKE '${FIX_PREFIX}%';
    DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE slug = '$SLUG');
    DELETE FROM public.permissions WHERE slug = '$SLUG';
    CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission_slug text, p_scope_type text DEFAULT 'global', p_scope_id text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE AS \$\$ BEGIN RETURN EXISTS (SELECT 1 FROM public.effective_permissions(p_user_id, p_scope_type, p_scope_id) ep WHERE ep.permission_slug = p_permission_slug); END \$\$;" >/dev/null 2>&1 || true
}
trap 'rm -rf "$TMP"; cleanup' EXIT
cleanup

precond="$(psql_fixture -c "select count(*) from public.permissions where slug = '$SLUG'")"
roles_present="$(psql_fixture -c "select count(*) from public.roles where slug in ('super-admin','system-admin','contest-manager')")"
[ "$precond" = 0 ] || fail "fixture must start WITHOUT the seed (permission row exists); run cleanup first"
[ "$roles_present" = 3 ] || fail "fixture is missing the 3 RBAC roles the seed keys on (found $roles_present)"

# ── 3. RED: the un-seeded state is reported as a failure in apply mode ─────────
# This is the blind spot that motivated the probe: the seed books its history
# row even when its INSERT…SELECT matched zero role rows.
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 1 ] || fail "un-seeded state must exit 1 in apply mode, got $rc: $out"
printf '%s\n' "$out" | grep -qF "transaction: read-only (transaction_read_only=on)" || fail "the probe did not confirm read-only from inside its own transaction"
printf '%s\n' "$out" | grep -qF "permission row: MISSING  $SLUG" || fail "RED: permission row not reported MISSING"
for r in super-admin system-admin contest-manager; do
  printf '%s\n' "$out" | grep -qF "grant: MISSING  $r -> $SLUG" || fail "RED: $r grant not reported MISSING"
done

# ── 4. PLAN mode: same findings, informational only ───────────────────────────
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode plan --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "plan mode must not block on findings, got $rc: $out"
printf '%s\n' "$out" | grep -qF "grant: MISSING  contest-manager -> $SLUG" || fail "plan mode hid the MISSING row"
printf '%s\n' "$out" | grep -qF 'WARNING (plan mode, not blocking)' || fail "plan mode findings not labelled"

# ── 5. bare slug = existence-only expectation ─────────────────────────────────
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$SLUG"
[ "$rc" -eq 1 ] || fail "bare slug must still fail when the row is absent, got $rc"
printf '%s\n' "$out" | grep -qF 'grant:' && fail "bare slug must not assert any role"

# ── 6. GREEN: apply the real seed file, then re-probe ─────────────────────────
psql_fixture -f "$SEED" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "seeded state must exit 0, got $rc: $out"
printf '%s\n' "$out" | grep -qF "permission row: present  $SLUG" || fail "GREEN: row not reported present"
printf '%s\n' "$out" | grep -qF 'is_system_permission=true' || fail "GREEN: the seed's is_system_permission flag was not reported (grep must not pass on a prefix)"
# A permission row that predates the seed makes its ON CONFLICT DO NOTHING a
# no-op, so the flag is the only signal that the row is not the one the seed
# wrote. Reporting it as a finding is the whole point of checking it.
psql_fixture -c "UPDATE public.permissions SET is_system_permission = false WHERE slug = '$SLUG';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 1 ] || fail "a non-system permission row must be a finding in apply mode, got $rc: $out"
printf '%s\n' "$out" | grep -qF 'is_system_permission=false' || fail "the flag finding was not printed"
psql_fixture -c "UPDATE public.permissions SET is_system_permission = true WHERE slug = '$SLUG';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "restored flag must pass again, got $rc: $out"
for r in super-admin system-admin contest-manager; do
  printf '%s\n' "$out" | grep -qF "grant: GRANTED  $r -> $SLUG" || fail "GREEN: $r grant not reported"
done
printf '%s\n' "$out" | grep -qF 'judge' && fail "GREEN: a role with no grant leaked into the holders list"
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$SLUG"
[ "$rc" -eq 0 ] || fail "bare slug must pass once seeded, got $rc"

# ── 7. read-only invariant: the probe cannot mutate what it verifies ───────────
counts() { psql_fixture -c "select (select count(*)::text from public.permissions) || '/' || (select count(*)::text from public.role_permissions) || '/' || (select count(*)::text from public.user_roles) || '/' || (select COALESCE(max(updated_at)::text,'-') from public.user_roles)"; }
before="$(counts)"
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "re-run (idempotence) must exit 0, got $rc: $out"
after="$(counts)"
[ "$before" = "$after" ] || fail "probe changed row counts or timestamps ($before -> $after)"

# ── 7b. the guarantee is per-transaction, so a writable SESSION ≠ a writable PROBE
# PGOPTIONS is a startup-parameter REQUEST. Measured on this fixture (2026-11-18):
# `-c` in PGOPTIONS beats ALTER DATABASE/ROLE SET, but a URI `options=` beats
# PGOPTIONS — the server then answers `off` and a `CREATE TABLE` succeeds. And
# measured against the real production target the next day (run 44478529252, the
# session pooler at aws-0-eu-north-1:5432): the pooler does not forward the
# client's `options` at all, so `SHOW default_transaction_read_only` answered
# `off` and the probe refused with 3 — correctly, but that made the tool unable
# to answer the one question it was built for. `BEGIN READ ONLY` is a statement,
# not a startup parameter, so it survives any pooler. This section therefore
# asserts BOTH halves: the wrapper makes a hostile session harmless, and
# without the wrapper a hostile session is refused rather than concluded over.
WRITABLE_URL="${TEST_DATABASE_URL%%\?*}?options=-c%20default_transaction_read_only%3Doff"
echo "== 7b. transaction-level read-only holds over a session the server made writable"
posture="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$WRITABLE_URL" -X -At \
  -c 'show default_transaction_read_only' 2>&1 | tail -1)"
[ "$posture" = "off" ] || fail "the fixture no longer demonstrates the hazard (DSN override yields '$posture', need 'off') — this case proves nothing while it is 'on'"
before7b="$(counts)"
run bash "$PROBE" --db-url "$WRITABLE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "a writable session must not stop the probe while every statement sits in BEGIN READ ONLY, got $rc: $out"
printf '%s\n' "$out" | grep -qF "transaction: read-only (transaction_read_only=on)" \
  || fail "the probe did not read its read-only guarantee from inside its own transaction: $out"
printf '%s\n' "$out" | grep -qF "session: default_transaction_read_only=off" \
  || fail "the probe must say plainly that the SESSION is writable — hiding that would re-create the blind spot: $out"
after7b="$(counts)"
[ "$before7b" = "$after7b" ] || fail "the probe wrote through a hostile session ($before7b -> $after7b)"

# The mutant that makes the wrapper load-bearing: strip BEGIN READ ONLY from q()
# and the same hostile DSN must be refused with 3, with no verdict lines. Assert
# the patch actually applied (one match, sha changed) — a no-op patch reports a
# survivor that was never a survivor.
MUT="$TMP/probe-nowrapper.sh"
n="$(grep -cE '^q\(\) \{ psql ' "$PROBE")"
[ "$n" = 1 ] || fail "expected exactly one q() definition to mutate, found $n"
awk '/^q\(\) \{ psql/ {print "q() { psql \"$DBURL\" -X -q -v ON_ERROR_STOP=1 -At -c \"$1\"; }"; next} {print}' \
  "$PROBE" > "$MUT"
[ "$(sha256sum < "$MUT" | cut -c1-16)" != "$(sha256sum < "$PROBE" | cut -c1-16)" ] \
  || fail "the mutant patch did not change the probe — this control proves nothing"
run bash "$MUT" --db-url "$WRITABLE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 3 ] || fail "without the wrapper a writable session must be refused with 3, got $rc: $out"
printf '%s\n' "$out" | grep -qF 'not read-only' || fail "the refusal must name the posture: $out"
printf '%s\n' "$out" | grep -qE '^  (permission row|grant|holders|rpc):' \
  && fail "a refused session reported verdicts anyway: $out"
# …and the guard tracks real capability, not the presence of a string: the same
# mutant over the ordinary DSN is fine, because there the session genuinely
# cannot write.
run bash "$MUT" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "an un-wrapped probe over a genuinely read-only session must still conclude, got $rc: $out"
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "the ordinary DSN must still pass after a posture refusal, got $rc: $out"

# ── 8. NEGATIVE CONTROL (the decisive case) ───────────────────────────────────
# Delete ONLY contest-manager's grant: the probe must go red on that role while
# super-admin stays green. A probe that reports all-or-nothing proves nothing.
psql_fixture -c "
  DELETE FROM public.role_permissions
   WHERE permission_id = (SELECT id FROM public.permissions WHERE slug = '$SLUG')
     AND role_id = (SELECT id FROM public.roles WHERE slug = 'contest-manager');" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 1 ] || fail "partial seed must exit 1, got $rc: $out"
printf '%s\n' "$out" | grep -qF "grant: MISSING  contest-manager -> $SLUG" || fail "partial seed: contest-manager not flagged"
printf '%s\n' "$out" | grep -qF "grant: GRANTED  super-admin -> $SLUG" || fail "partial seed: super-admin must stay GRANTED"
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode plan --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "partial seed must not block plan mode, got $rc"

# Re-applying the idempotent seed restores the missing grant, and the probe
# returns to green — the same property the scoped lane relies on.
psql_fixture -f "$SEED" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "restored seed must pass, got $rc: $out"

# ── 9. enforcement-path sample: does a real holder resolve the permission? ────
leftover="$(psql_fixture -c "select count(*) from public.user_roles ur join public.roles r on r.id = ur.role_id where r.slug in ('super-admin','system-admin','contest-manager') and ur.scope_type = 'global' and ur.is_active")"
[ "$leftover" = 0 ] || fail "fixture holds $leftover live RBAC assignment(s) this harness did not make — clean them before reading a sample count"
psql_fixture -c "
  INSERT INTO public.platform_users (id, email, first_name, last_name)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '$FIX_USERS', 'Probe', 'Fixture');
  INSERT INTO public.user_roles (user_id, role_id, scope_type, is_active)
  SELECT '00000000-0000-0000-0000-0000000000a1', id, 'global', true
    FROM public.roles WHERE slug = 'contest-manager';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "sampled holder passing must stay green, got $rc: $out"
printf '%s\n' "$out" | grep -qF "rpc: OK  contest-manager -> $SLUG" || fail "RPC sample not reported for contest-manager"
printf '%s\n' "$out" | grep -qE "rpc: OK  contest-manager -> $SLUG \(1 of 1 eligible holder" \
  || fail "the sample must state how many holders were eligible: $out"
printf '%s\n' "$out" | grep -qE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
  && fail "the probe printed a full user id into the log — it must be masked"
psql_fixture -c "
  INSERT INTO public.platform_users (id, email, first_name, last_name)
  VALUES ('$FIX_ID2', '$FIX_USERS2', 'Probe', 'Second');
  INSERT INTO public.user_roles (user_id, role_id, scope_type, is_active)
  SELECT '$FIX_ID2', id, 'global', true
    FROM public.roles WHERE slug = 'contest-manager';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "two holders must still pass, got $rc: $out"
printf '%s\n' "$out" | grep -qE "rpc: OK  contest-manager -> $SLUG \(1 of 2 eligible holders" \
  || fail "the eligible-holder count did not follow the fixture: $out"
psql_fixture -c "
  DELETE FROM public.user_roles WHERE user_id = '$FIX_ID2';
  DELETE FROM public.platform_users WHERE id = '$FIX_ID2';" >/dev/null

# Expired / inactive / scoped-out assignments must not be sampled: they would
# report false alarms on a correctly seeded database.
psql_fixture -c "
  UPDATE public.user_roles SET is_active = false
   WHERE user_id = '00000000-0000-0000-0000-0000000000a1';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "an inactive holder is not a seed failure, got $rc: $out"
printf '%s\n' "$out" | grep -qF "rpc: no eligible holder for contest-manager" || fail "inactive holder not excluded from the sample"
psql_fixture -c "
  UPDATE public.user_roles SET is_active = true
   WHERE user_id = '00000000-0000-0000-0000-0000000000a1';" >/dev/null

# A per-user DENY override also removes the grant for that holder, so the sample
# must exclude such users rather than blame the seed.
psql_fixture -c "
  INSERT INTO public.user_permissions (user_id, permission_id, effect, scope_type)
  SELECT '00000000-0000-0000-0000-0000000000a1', id, 'deny', 'global'
    FROM public.permissions WHERE slug = '$SLUG';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "a denied user must not fail the probe, got $rc: $out"
printf '%s\n' "$out" | grep -qF "rpc: no eligible holder for contest-manager" \
  || fail "the globally denied holder was sampled anyway: $out"

# … but ONLY a global deny disqualifies a holder: the RPC is called with the
# default 'global' scope, so effective_permissions ignores a contest-scoped
# override and the permission still resolves. Dropping that scope predicate
# would shrink the sample to nothing on a correct database — the quiet failure
# this harness exists to keep honest.
psql_fixture -c "
  DELETE FROM public.user_permissions WHERE user_id = '00000000-0000-0000-0000-0000000000a1';
  INSERT INTO public.user_permissions (user_id, permission_id, effect, scope_type)
  SELECT '00000000-0000-0000-0000-0000000000a1', id, 'deny', 'contest'
    FROM public.permissions WHERE slug = '$SLUG';" >/dev/null
run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode apply --expect "$EXPECT"
[ "$rc" -eq 0 ] || fail "a contest-scoped deny must not fail the probe, got $rc: $out"
printf '%s\n' "$out" | grep -qF "rpc: OK  contest-manager -> $SLUG" \
  || fail "a contest-scoped deny wrongly disqualificed the only holder: $out"
psql_fixture -c "
  DELETE FROM public.user_permissions
   WHERE user_id = '00000000-0000-0000-0000-0000000000a1';" >/dev/null

# ── 10. stability guard: never call a function that could write ───────────────
# The lane points at production. Calling the RPC is only safe while the catalog
# says it is STABLE/IMMUTABLE, so the probe reads provolatile first. Making the
# real function VOLATILE must degrade to a skip — not an error, and not a call.
psql_fixture -c "ALTER FUNCTION public.user_has_permission(uuid, text, text, text) VOLATILE;" >/dev/null
for mode in plan apply; do
  run bash "$PROBE" --db-url "$TEST_DATABASE_URL" --mode "$mode" --expect "$EXPECT"
  [ "$rc" -eq 0 ] || fail "VOLATILE rpc must not fail the probe ($mode), got $rc: $out"
  printf '%s\n' "$out" | grep -qF 'rpc: SKIPPED' || fail "VOLATILE rpc not reported as skipped ($mode)"
  printf '%s\n' "$out" | grep -qF "rpc: OK  contest-manager -> $SLUG" && fail "VOLATILE rpc was still called ($mode)"
done
psql_fixture -c "ALTER FUNCTION public.user_has_permission(uuid, text, text, text) STABLE;" >/dev/null

# ── 11. an unreachable DB is a distinct verdict from a failed assertion ───────
run bash "$PROBE" --db-url "postgres://n:n@127.0.0.1:1/postgres" --mode apply --expect "$EXPECT"
[ "$rc" -eq 3 ] || fail "connection failure must exit 3 (not an assertion failure), got $rc: $out"

echo "PASS"
