#!/usr/bin/env bash
# test-railway-status-guard.sh — prove scripts/ci/railway-status-guard.sh rides out a
# transient Railway read failure WITHOUT weakening what the pre-flight is for.
#
# WHY THIS EXISTS
# Dispatch `45179114945` (run 45179114945, job `137707997676`, 2026-11-23 ~12:53Z) was an
# ops upload to staging that never packed a byte. It died at step 8 —
#     railway status --json > /tmp/railway-status.json
# — with the F2 body:
#     Failed to fetch: error decoding response body
# Eight minutes later, run `45179580758` (job `137709644373`, 13:01:27Z) called the same
# command, with the same secret (RAILWAY_TOKEN_STAGING), on the same pinned CLI (5.40.1),
# from a hosted runner with no link config, and got `rc=0 bytes=52349 verdict=decoded`.
# Nothing about the credential, the flags or the tree decided the difference: the
# single-shot call did. The repo already answers that class of fault for `railway up`
# through scripts/ci/with-retry.sh (see test-railway-deploy-retry.sh); this pre-flight
# was the one Railway call in the lane still left single-shot, and it is the call that
# stands between "a blip costs a redeploy" and "a blip aborts the deploy".
#
# WHAT MUST NOT BE LOST
# The step exists to prove the token reaches the environment and service the operator
# NAMED before any byte leaves the runner, so a mis-set secret cannot upload somewhere
# else. So these cases are in the suite too: a readable status that names the WRONG
# environment must refuse (attempt 1, no retry), and one that names the right environment
# but the WRONG service must refuse. A retry that turns the guard into "keep asking until
# anything answers" would be worse than the bug it fixes.
#
# HOW IT WORKS
# A stub `railway` on PATH plays each shape from a scripted list and appends every
# invocation to a counter file. Each assertion checks the exit code AND the call count,
# because "exited 0" alone is also what a suite reports when the retry was never reached.
# The never-recovers case is the red control: a suite whose every case passes whatever the
# script does proves nothing.
#
# Mutation proof (run it after editing the guard): delete the retry loop in
# railway-status-guard.sh and this suite must go red on CASE A, not just CASE B.
#
# Run:  bash scripts/ci/test-railway-status-guard.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
guard="$repo_root/scripts/ci/railway-status-guard.sh"
workflow="$repo_root/.github/workflows/ops-railway-upload.yml"

command -v jq >/dev/null || { echo "FAIL: jq is required"; exit 1; }
[ -f "$guard" ] || { echo "FAIL: $guard missing"; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

# A status body with the two fields the guard reads, same shape the workflow parsed
# inline before this script existed: environments -> serviceInstances -> serviceName.
# The body is built inside the stub (it runs in a subshell, so no helper here).

# stub railway: SCRIPT is a ';'-separated list of behaviors,
#   ok:<env>:<svc>  -> exit 0 and print a status body
#   decode          -> exit 1 and print the F2 body
#   empty           -> exit 0 with NO body (the dangerous shape: rc says fine, jq says nothing)
#   blocked:<words> -> exit 1 and print an account-state sentence
make_stub() {
  cat > "$work/bin/railway" <<STUB
#!/usr/bin/env bash
echo "call" >> "$work/calls"
n=\$(wc -l < "$work/calls" | tr -d ' ')
script="\$RAILWAY_STUB_SCRIPT"
i=1
body=""
IFS=';' read -ra cells <<< "\$script"
for cell in "\${cells[@]}"; do
  if [ "\$i" -ge "\$n" ]; then body="\$cell"; break; fi
  i=\$((i + 1))
done
case "\$body" in
  ok:*)
    rest="\${body#ok:}"
    printf '{"environments":{"edges":[{"node":{"name":"%s","serviceInstances":{"edges":[{"node":{"serviceName":"%s"}}]}}}]}}\n' \\
      "\${rest%%:*}" "\${rest##*:}"
    exit 0 ;;
  repeat:*)
    rest="\${body#repeat:}"
    printf '{"environments":{"edges":[{"node":{"name":"%s","serviceInstances":{"edges":[{"node":{"serviceName":"%s"}}]}}}]}}\n' \\
      "\${rest%%:*}" "\${rest##*:}"
    exit 0 ;;
  empty)
    exit 0 ;;
  blocked:*)
    printf '%s\n' "\${body#blocked:}" >&2
    exit 1 ;;
  *)
    echo "Failed to fetch: error decoding response body" >&2
    echo "  0: error decoding response body" >&2
    echo "  1: expected value at line 1 column 1" >&2
    exit 1 ;;
esac
STUB
  chmod +x "$work/bin/railway"
}

# run_guard <stub-script> <environment> <service> — echoes "rc|calls|output"
run_guard() {
  local script="$1" env="$2" svc="$3" out rc calls
  : > "$work/calls"
  make_stub
  out="$(PATH="$work/bin:$PATH" RAILWAY_STUB_SCRIPT="$script" \
    ENVIRONMENT="$env" SERVICE="$svc" STATUS_OUT="$work/status.json" \
    STATUS_ATTEMPTS=4 STATUS_BASE_DELAY_S=0 \
    bash "$guard" 2>&1)"
  rc=$?
  calls="$(wc -l < "$work/calls" | tr -d ' ')"
  printf '%s|%s|%s' "$rc" "$calls" "$out"
}

pass=0 fail=0
check() {
  local label="$1" cond="$2" detail="$3"
  if [ "$cond" = "1" ]; then
    pass=$((pass + 1)); echo "ok   $label"
  else
    fail=$((fail + 1)); echo "FAIL $label — $detail"
  fi
}

echo "== scripts/ci/railway-status-guard.sh =="

# CASE A — the real window: two decode refusals, then a good read. Must pass on try 3.
r="$(run_guard 'decode;decode;ok:production:frontend-web' production frontend-web)"
rc="${r%%|*}"; rest="${r#*|}"; calls="${rest%%|*}"; out="${rest#*|}"
[ "$rc" = "0" ] && check "A transient decode does not abort the lane" 1 "exit $rc :: $(printf '%s' "$out" | tail -2)" \
                || check "A transient decode does not abort the lane" 0 "exit $rc :: $(printf '%s' "$out" | tail -2)"
[ "$calls" = "3" ] && check "A retried on the 3rd attempt (calls=3)" 1 "calls=$calls (retry never reached?)" \
                   || check "A retried on the 3rd attempt (calls=3)" 0 "calls=$calls"
printf '%s' "$out" | grep -q "token resolves production / frontend-web" \
  && check "A still prints the resolution line" 1 "output: $(printf '%s' "$out" | tail -3)" \
  || check "A still prints the resolution line" 0 "output: $(printf '%s' "$out" | tail -3)"

# CASE B — the bound: never recovers. Must fail, and must have burned exactly the budget.
r="$(run_guard 'decode;decode;decode;decode' production frontend-web)"
rc="${r%%|*}"; rest="${r#*|}"; calls="${rest%%|*}"; out="${rest#*|}"
[ "$rc" != "0" ] && check "B a permanent decode refusal still fails the lane" 1 "exit $rc" \
                 || check "B a permanent decode refusal still fails the lane" 0 "exit 0 (guard gave up silently?)"
[ "$calls" = "4" ] && check "B tried the full STATUS_ATTEMPTS budget (calls=4)" 1 "calls=$calls" \
                   || check "B tried the full STATUS_ATTEMPTS budget (calls=4)" 0 "calls=$calls"
printf '%s' "$out" | grep -q "::error::" \
  && check "B reports the failure as a workflow annotation" 1 "no ::error:: in output" \
  || check "B reports the failure as a workflow annotation" 0 "no ::error:: in output"

# CASE C — account state is not a window: fail fast, one call, no 4-try ladder.
r="$(run_guard 'blocked:Your trial has expired. Please select a plan;ok:production:frontend-web' production frontend-web)"
rc="${r%%|*}"; rest="${r#*|}"; calls="${rest%%|*}"; out="${rest#*|}"
[ "$rc" != "0" ] && check "C an expired trial fails the lane" 1 "exit $rc" \
                 || check "C an expired trial fails the lane" 0 "exit 0"
[ "$calls" = "1" ] && check "C does not retry an account-state answer (calls=1)" 1 "calls=$calls (it retried a non-window)" \
                   || check "C does not retry an account-state answer (calls=1)" 0 "calls=$calls"

# CASE D — the safety property: a readable status naming the WRONG environment must refuse.
r="$(run_guard 'repeat:development:backend' production frontend-web)"
rc="${r%%|*}"; rest="${r#*|}"; calls="${rest%%|*}"; out="${rest#*|}"
[ "$rc" != "0" ] && check "D refuses a token aimed at another environment" 1 "exit $rc" \
                 || check "D refuses a token aimed at another environment" 0 "exit 0 — the pre-flight is inert"
[ "$calls" = "1" ] && check "D refuses at once, no retry needed" 1 "calls=$calls" \
                   || check "D refuses at once, no retry needed" 0 "calls=$calls"
printf '%s' "$out" | grep -q "refusing to deploy" \
  && check "D says it is refusing to deploy" 1 "output: $(printf '%s' "$out" | tail -3)" \
  || check "D says it is refusing to deploy" 0 "output: $(printf '%s' "$out" | tail -3)"

# CASE E — right environment, wrong service: refuse before bytes leave.
r="$(run_guard 'repeat:production:backend' production frontend-web)"
rc="${r%%|*}"; out="${r#*|}"
[ "$rc" != "0" ] && check "E refuses when the named service is absent" 1 "exit $rc" \
                 || check "E refuses when the named service is absent" 0 "exit 0 — the pre-flight is inert"

# CASE F — an empty body that still exits 0 must not read as "resolved": retry it.
r="$(run_guard 'empty;ok:production:frontend-web' production frontend-web)"
rc="${r%%|*}"; rest="${r#*|}"; calls="${rest%%|*}"; out="${rest#*|}"
[ "$rc" = "0" ] && check "F an empty first body recovers into a good read" 1 "exit $rc :: $(printf '%s' "$out" | tail -2)" \
                || check "F an empty first body recovers into a good read" 0 "exit $rc"
[ "$calls" = "2" ] && check "F retried the empty body (calls=2)" 1 "calls=$calls — an empty read was accepted as resolved" \
                   || check "F retried the empty body (calls=2)" 0 "calls=$calls"

# CASE G — the lane must actually call this script (the step used to inline the call).
grep -q "railway-status-guard.sh" "$workflow" \
  && check "ops-railway-upload.yml runs the guard" 1 "workflow still calls railway status inline" \
  || check "ops-railway-upload.yml runs the guard" 0 "workflow still calls railway status inline"
grep -qE "^\s*railway status --json" "$workflow" \
  && check "no single-shot railway status left in the lane" 0 "an unwrapped railway status --json remains" \
  || check "no single-shot railway status left in the lane" 1 ""

echo "== summary =="
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "OK: the ops pre-flight rides out a window and still refuses a misplaced token"
