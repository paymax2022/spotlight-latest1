#!/usr/bin/env bash
# test-f2-token-probe.sh — prove the F2 probe classifies each 2x2 cell correctly
# and cannot be tricked into a "the token can deploy" verdict.
#
# WHY THIS EXISTS
# scripts/ci/f2-token-probe.sh runs in exactly one place — a GitHub runner that
# holds the staging project token — so its own output can never be re-checked
# afterwards against a known truth. Everything that decides the verdict is
# therefore extracted into scripts/ci/f2-probe-verdict.py and driven here with
# recorded payloads. Two of these payloads are real measurements, not
# inventions: the unauthenticated HTTP-200 "Not Authorized" body (2026-11-22)
# and the "error decoding response body" shape that F2 prints.
#
# It follows the house pattern of test-railway-deploy-retry.sh: every case
# checks the VALUE, and a red control is included — a payload that must NOT read
# as a green verdict — because a suite that prints the same token whatever the
# input is worth nothing at 2 a.m.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

V=("python3" "scripts/ci/f2-probe-verdict.py")
probe=scripts/ci/f2-token-probe.sh
wf=.github/workflows/ci-f2-token-probe.yml
fails=0
checks=0

expect() { # <label> <expected> <actual> <cell> <payload...>
  checks=$((checks + 1))
  if [[ "$2" == "$3" ]]; then
    echo "ok   $1 -> $3"
  else
    echo "FAIL $1: expected '$2', got '$3'"
    echo "       ran: ${V[*]} $4 $5"
    fails=$((fails + 1))
  fi
}

want() { # <label> <regex> <file> <present|absent>
  checks=$((checks + 1))
  if grep -qE "$2" "$3"; then
    [[ "$4" == present ]] && echo "ok   $1" || { echo "FAIL $1"; fails=$((fails + 1)); }
  else
    [[ "$4" == absent ]] && echo "ok   $1" || { echo "FAIL $1"; fails=$((fails + 1)); }
  fi
}

# ---------------------------------------------------------------- auth / read
# The measured rejection body: Railway answers 200 and puts the failure in
# errors[].message, so a status-code-only classifier calls this success.
REJ='{"errors":[{"message":"Not Authorized","extensions":{"code":"INTERNAL_SERVER_ERROR"}}],"data":null}'
expect "auth: measured Not Authorized body at HTTP 200" "token-rejected" \
  "$("${V[@]}" read "$REJ" 200)" read "\"$REJ\" 200"
expect "auth: clean project read" "ok" \
  "$("${V[@]}" read '{"data":{"project":{"id":"e7dca861","name":"spotlight"}}}' 200)" \
  read "good project body 200"
expect "auth: HTTP 403 at the edge" "edge-rejected-403" \
  "$("${V[@]}" read 'irrelevant' 403)" read "'irrelevant' 403"
expect "auth: no response at all" "transport-error-no-response" \
  "$("${V[@]}" read '' '')" read "'' ''"
# F2's own fingerprint: a body a JSON client cannot parse.
expect "auth: undecodable body (the F2 shape)" "body-undecodable" \
  "$("${V[@]}" read '<html>502</html>' 200)" read "'<html>502</html>' 200"
expect "auth: FORBIDDEN wording" "token-not-permitted" \
  "$("${V[@]}" read '{"errors":[{"message":"Forbidden: no permission"}]}' 200)" \
  read "forbidden body 200"

# ------------------------------------------------------------------- mutation
expect "mutation: the accepted true" "accepted" \
  "$("${V[@]}" mutation '{"data":{"serviceInstanceDeploy":true}}' 200)" \
  mutation "true 200"
expect "mutation: FORBIDDEN is a scope answer, not a failure" "token-not-permitted" \
  "$("${V[@]}" mutation '{"errors":[{"message":"Forbidden"}]}' 200)" mutation "forbidden 200"
expect "mutation: Not Authorized" "token-rejected" \
  "$("${V[@]}" mutation "$REJ" 200)" mutation "\"$REJ\" 200"
expect "mutation: F2 on this path too" "body-undecodable" \
  "$("${V[@]}" mutation 'not json at all' 200)" mutation "'not json at all' 200"
expect "mutation: schema drift (unexpected data shape)" "mutation-shape-drift" \
  "$("${V[@]}" mutation '{"data":{"other":1}}' 200)" mutation "unknown field 200"

# ------------------------------------------------------------------- readback
# `true` is NOT the verdict: production's git-less frontend-admin returns true
# and creates no deployment row. These cases are the reason cell 4 exists.
expect "readback: new row SUCCESS" "build-success" \
  "$("${V[@]}" readback '[{"id":"aaaa1111","status":"SUCCESS","isNew":true}]')" \
  readback "new SUCCESS row"
expect "readback: new row FAILED" "build-failed" \
  "$("${V[@]}" readback '[{"id":"aaaa1111","status":"FAILED","isNew":true}]')" \
  readback "new FAILED row"
expect "readback: same row, nothing new (the no-op)" "no-new-row" \
  "$("${V[@]}" readback '[{"id":"20af4cc5","status":"SUCCESS","isNew":false}]')" \
  readback "unchanged row"
expect "readback: new row still building" "build-pending-or-cancelled" \
  "$("${V[@]}" readback '[{"id":"aaaa1111","status":"IN_PROGRESS","isNew":true}]')" \
  readback "new IN_PROGRESS row"

# ---------------------------------------------------------------------- final
expect "final: the green cell we are hunting" "project-token-can-deploy" \
  "$("${V[@]}" final ok ok accepted build-success mutate)" final "ok ok accepted build-success mutate"
expect "final: accepted but inert" "mutation-is-noop-for-project-token" \
  "$("${V[@]}" final ok ok accepted no-new-row mutate)" final "ok ok accepted no-new-row mutate"
expect "final: token cannot authenticate" "token-cannot-authenticate (token-rejected)" \
  "$("${V[@]}" final token-rejected ok not-run not-run mutate)" final "token-rejected ok not-run not-run mutate"
expect "final: F2 reaches the mutation path" "f2-reproduces-on-the-mutation-path" \
  "$("${V[@]}" final ok ok body-undecodable not-run mutate)" final "ok ok body-undecodable not-run mutate"
expect "final: read-only run never claims a deploy verdict" "read-only-ran" \
  "$("${V[@]}" final ok ok not-run not-run read-only)" final "read-only"
expect "final: an unreadable read is not the token's fault" "read-path-fault (body-undecodable)" \
  "$("${V[@]}" final body-undecodable ok not-run not-run mutate)" final "body-undecodable ok not-run not-run mutate"
# The ordering itself, pinned: auth outranks mode. Swap the two blocks in
# final_verdict and this goes red — a read-only dispatch that was quietly
# hitting the decode fault would otherwise report "read-only-ran".
expect "final: a faulting read-only run is never 'clean'" "read-path-fault (body-undecodable)" \
  "$("${V[@]}" final body-undecodable ok not-run not-run read-only)" final "body-undecodable … read-only"
# RED CONTROLS: a permissive mapping here is what reads as success at 2 a.m.
expect "final: a falsy field is NOT a deploy" "undecided (ok/returned-falsy/not-run)" \
  "$("${V[@]}" final ok ok returned-falsy not-run mutate)" final "ok ok returned-falsy not-run mutate"
expect "final: an unchanged row is never project-token-can-deploy" "mutation-is-noop-for-project-token" \
  "$("${V[@]}" final ok ok accepted no-new-row mutate)" final "again: no-new-row"

# ------------------------------------------------------- invariants of the run
# 1. The probe must never upload: an upload that SUCCEEDED from a throwaway
#    directory would deploy that directory — the very failure mode being studied.
#    Comments are stripped first: the script DOCUMENTS that it does not upload,
#    so grepping the raw file would fail on the sentence that proves the intent.
code_only=$(sed 's/#.*//' "$probe")
checks=$((checks + 1))
if printf '%s\n' "$code_only" | grep -qE '(^|[^a-z])railway up'; then
  echo "FAIL probe invokes 'railway up'"; fails=$((fails + 1))
else
  echo "ok   probe performs no upload (code, not prose)"
fi
# 2. The token travels only in a header, never inside a GraphQL document.
want "token is sent as a header" 'Authorization: Bearer' "$probe" present
checks=$((checks + 1))
if grep -nE 'query|mutation' "$probe" | grep -q 'RAILWAY_TOKEN'; then
  echo "FAIL token appears on a document line"; fails=$((fails + 1))
else
  echo "ok   token never appears on a document line"
fi
# 3. Each cell sends only its own declared variables. An undeclared extra is a
#    GraphQL validation error, and a silent 400 would read as a token answer.
bash "$probe" --check-documents > /tmp/f2-probe-docs.txt
want "auth document declares \$p" 'query\(\$p:String!\)' /tmp/f2-probe-docs.txt present
want "row document declares \$s and \$e" 'query\(\$s:String!,\$e:String!\)' /tmp/f2-probe-docs.txt present
want "deploy document declares \$latest" 'mutation\(\$s:String!,\$e:String!,\$latest:Boolean\)' /tmp/f2-probe-docs.txt present
# 4. Dispatch-only: pushing this file must not be able to reach Railway.
#    Line-anchored — an input's name and its default sit on different YAML
#    lines, so a one-line regex there would pass for the wrong reason.
want "workflow has no automatic trigger" '^[[:space:]]*(push|schedule|pull_request|release):' "$wf" absent
want "entry point is workflow_dispatch" 'workflow_dispatch' "$wf" present
want "mode defaults to read-only" 'default: read-only' "$wf" present
want "repository guard present" 'if: github.repository ==' "$wf" present
want "staging secret is the one used" 'RAILWAY_TOKEN_STAGING' "$wf" present
# 5. Staging is not negotiable at dispatch time: the workflow exposes no
#    environment, and the probe hardcodes exactly one environment id.
want "workflow takes no environment input" '^[[:space:]]+environment(_id)?:' "$wf" absent
env_lines=$(grep -cE 'ENVIRONMENT_ID:-[0-9a-f-]{36}' "$probe")
checks=$((checks + 1))
if [[ "$env_lines" == 1 ]] && grep -q 'STAGING_ENV_ID="${PROBE_ENVIRONMENT_ID:-6b5f27a3-a290-4574-a977-363eb21d43ad}"' "$probe"; then
  echo "ok   one environment id and it is staging's"
else
  echo "FAIL environment id is not pinned to staging ($env_lines hardcoded)"; fails=$((fails + 1))
fi

# ------------------------------------------------- end-to-end against a stub edge
# The classifier cases above prove the MAPPING. These three prove the SCRIPT:
# the transport, handing the HTTP code back out of the subshell, masking the
# token, and diffing a new row id against the baseline — the four things that
# can print a confident wrong answer and are invisible to a payload test. The
# subshell one is not hypothetical: the first local run printed
# "auth=transport-error-no-response (http=)" under a body that parsed fine.
stub_out=/tmp/f2-probe-stub.out
run_stub() { # <scenario> <mode>
  python3 scripts/ci/f2-probe-stub.py "$1" 0 > "$stub_out" 2>/dev/null &
  local pid=$! port="" i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    port=$(head -1 "$stub_out" 2>/dev/null)
    [[ -n "$port" ]] && break
    sleep 0.2
  done
  if [[ -z "$port" ]]; then kill "$pid" 2>/dev/null; echo "STUB-FAILED"; return 1; fi
  RAILWAY_API_URL="http://127.0.0.1:${port}/graphql" \
  RAILWAY_TOKEN="STUB-SECRET-NOT-A-TOKEN" \
  PROBE_MODE="$2" PROBE_SERVICE_NAME=backend \
  PROBE_POLL_BUDGET_S=3 PROBE_POLL_INTERVAL_S=1 \
  PROBE_VERDICT_FILE=/tmp/f2-probe-verdict.test \
    bash "$probe" > /tmp/f2-probe-stub-run.out 2>&1
  local rc=$?
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  STUB_RC=$rc
}
contains() { # <label> <needle>
  checks=$((checks + 1))
  if grep -qF "$2" /tmp/f2-probe-stub-run.out; then echo "ok   $1";
  else echo "FAIL $1 — got: $(cat /tmp/f2-probe-stub-run.out | tr '\n' ' ' | head -c 400)"; fails=$((fails + 1)); fi
}

run_stub ok mutate
contains "stub/ok: http 200 survives the subshell" "PROBE_CELL auth=ok (http=200)"
contains "stub/ok: baseline read is ok" "PROBE_CELL baseline=ok"
contains "stub/ok: mutation accepted" "PROBE_CELL mutation=accepted"
contains "stub/ok: the new row is detected" "PROBE_CELL readback=build-success"
contains "stub/ok: the green verdict" "PROBE_VERDICT[backend]=project-token-can-deploy"
checks=$((checks + 1))
if grep -qF 'STUB-SECRET-NOT-A-TOKEN' /tmp/f2-probe-stub-run.out; then
  echo "FAIL token leaked into probe output"; fails=$((fails + 1))
else
  echo "ok   token masked in probe output"
fi
checks=$((checks + 1))
[[ "$STUB_RC" == 0 ]] && echo "ok   stub/ok exits 0" || { echo "FAIL stub/ok exit=$STUB_RC"; fails=$((fails + 1)); }

# The measured rejection: HTTP 200 + "Not Authorized". A naive probe calls this
# success because the status code is fine.
run_stub unauthorized mutate
contains "stub/unauthorized: body read as a token answer, not 200=ok" "PROBE_CELL auth=token-rejected"
contains "stub/unauthorized: does not claim a deploy" "token-cannot-authenticate (token-rejected)"
checks=$((checks + 1))
if grep -qF 'project-token-can-deploy' /tmp/f2-probe-stub-run.out; then
  echo "FAIL stub/unauthorized still printed the green verdict"; fails=$((fails + 1))
else
  echo "ok   stub/unauthorized never prints the green verdict"
fi
checks=$((checks + 1))
[[ "$STUB_RC" == 1 ]] && echo "ok   stub/unauthorized exits 1" || { echo "FAIL stub/unauthorized exit=$STUB_RC"; fails=$((fails + 1)); }

# F2's own fingerprint, seen on a plain read: no JSON at all.
# F2's own fingerprint, seen on a plain read: no JSON at all.
run_stub undecodable mutate
contains "stub/undecodable: the F2 body is recognised" "PROBE_CELL auth=body-undecodable"
contains "stub/undecodable: blamed on the path, not the secret" "read-path-fault (body-undecodable)"
# The cheapest dispatch must not look clean: read-only has no mutation cell, so
# an undecodable read is ALL it sees — and it still has to say "fault", not
# "read-only-ran". This is what the auth-before-mode ordering buys.
run_stub undecodable read-only
contains "stub/undecodable read-only: still reports the fault" "read-path-fault (body-undecodable)"
checks=$((checks + 1))
if grep -qF 'read-only-ran' /tmp/f2-probe-stub-run.out; then
  echo "FAIL a faulting read-only run reported itself as clean"; fails=$((fails + 1))
else
  echo "ok   a faulting read-only run does not report 'read-only-ran'"
fi

# 6. The dispatch form must actually reach the script. A job env key the script
#    never reads is silently ignored, so `service=frontend-web` would probe
#    backend and print a confident answer to a question nobody asked. This was
#    a real bug in the first version: the workflow exported SERVICE_NAME while
#    the script reads PROBE_SERVICE_NAME.
#    Regex, not PyYAML: this job's python3 has no third-party packages.
maps=$(sed -nE 's/^[[:space:]]+([A-Z_]+):[[:space:]]*\$\{\{ github\.event\.inputs\.([a-z-]+) \}\}[[:space:]]*$/\1 \2/p' "$wf")
checks=$((checks + 1))
if [[ -z "$maps" ]]; then
  echo "FAIL no input->env mappings found in $wf (parser or file changed)"; fails=$((fails + 1))
else
  wiring_ok=1
  while read -r key input; do
    [[ -z "$key" ]] && continue
    if ! grep -q "\${$key" "$probe"; then
      echo "FAIL env $key is exported but $probe never reads it"; wiring_ok=0
    fi
    if ! grep -qE "^[[:space:]]+$input:" "$wf"; then
      echo "FAIL maps to input '$input', which the workflow does not declare"; wiring_ok=0
    fi
  done <<< "$maps"
  [[ $wiring_ok == 1 ]] && echo "ok   every dispatch input lands on a key the script reads ($(printf '%s\n' "$maps" | grep -c .) mappings)"
  [[ $wiring_ok == 1 ]] || fails=$((fails + 1))
fi

# 6b. The "Verdict" step cats a hardcoded path; the script writes
#     ${PROBE_VERDICT_FILE:-/tmp/f2-probe-verdict}. If those two literals ever
#     drift, the summary prints "No verdict written" after a run that actually
#     produced one — a silent loss of the only deliverable.
verdict_default=$(sed -nE 's/^VERDICT_FILE="\$\{PROBE_VERDICT_FILE:-([^}]+)\}"$/\1/p' "$probe")
checks=$((checks + 1))
if [[ -n "$verdict_default" ]] && grep -qF "$verdict_default" "$wf"; then
  echo "ok   the summary step reads the file the script writes ($verdict_default)"
else
  echo "FAIL verdict path drift: script writes '${verdict_default:-<unparsed>}', workflow cats another file"; fails=$((fails + 1))
fi

# 6c. CI must use the curl transport. `cli` shells out to the Railway CLI with an
#     owner session, which no runner has — and it reports http=cli-transport, so
#     the edge status that distinguishes token-rejected from F2 would be lost.
checks=$((checks + 1))
if grep -qE '^[[:space:]]+PROBE_TRANSPORT: curl[[:space:]]*$' "$wf"; then
  echo "ok   CI pins the curl transport"
else
  echo "FAIL CI does not pin PROBE_TRANSPORT=curl"; fails=$((fails + 1))
fi

# ---------------------------------------------------------------- token-class
# .github/workflows/ci-railway-token-class.yml answers "is the staging credential
# broken, or is the whole project-token class unable to reach the deployment
# graph?" — and it does it while holding three live tokens, so its safety
# invariants are the thing under test, not decoration.
tc=.github/workflows/ci-railway-token-class.yml
checks=$((checks + 1))
if [[ -f "$tc" ]]; then echo "ok   the token-class comparison exists"
else echo "FAIL $tc missing"; fails=$((fails + 1)); fi
want "token-class: dispatch-only, nothing can reach it by pushing" \
  '^[[:space:]]*(push|schedule|pull_request|release):' "$tc" absent
# The load-bearing one: PROBE_MODE is the only thing that keeps this file out of
# the mutation cell, so it must be a literal in the YAML, not an input mapping.
want "token-class: mode is the literal read-only, not an input" \
  '^[[:space:]]+PROBE_MODE: read-only[[:space:]]*$' "$tc" present
want "token-class: the word 'mutate' appears nowhere in the file" 'mutate' "$tc" absent
want "token-class: no inputs block to steer it" '^[[:space:]]+inputs:' "$tc" absent
want "token-class: repository guard present" 'if: github.repository ==' "$tc" present
# All three credentials, because a comparison of one token against nothing cannot
# separate class from value. Names must match what the repository actually has.
for s in RAILWAY_TOKEN_DEVELOPMENT RAILWAY_TOKEN_STAGING RAILWAY_TOKEN_PRODUCTION; do
  want "token-class: uses $s" "$s" "$tc" present
done
# A refused read is the ANSWER here. A step that stops on the first non-zero exit
# leaves the later credentials untested and the summary table half-filled — which
# reads exactly like "the class is fine, staging alone broke".
# Same-line, not two counts: the file's own header documents this rule, so a
# `|| true` counted anywhere would pass on the prose that explains it.
tc_tolerant=$(grep -Ec 'f2-token-probe\.sh.*\|\| true' "$tc")
checks=$((checks + 1))
if [[ "$tc_tolerant" == 4 ]]; then
  echo "ok   token-class: all four credentials run even when a read is refused"
else
  echo "FAIL token-class: only $tc_tolerant/4 probe calls tolerate a non-zero exit"; fails=$((fails + 1))
fi
# The control row is what makes "Not Authorized" mean something: Railway answers
# HTTP 200 for auth failures, so a token and no-token look identical unless both
# are run against the same query.
want "token-class: an empty-credential control exists" \
  "RAILWAY_TOKEN: ''" "$tc" present
want "token-class: the summary globs the files the steps tee" \
  'glob\.glob\("/tmp/class-' "$tc" present
want "token-class: tee writes the per-label file the summary reads" \
  'tee "/tmp/class-' "$tc" present
# Reading rules that the workflow header claims — assert the code says them, so
# the doc cannot drift from the classifier it describes.
want "token-class: dev-ok/staging-refused is reported as VALUE" \
  'VALUE, not class' "$tc" present
want "token-class: all-refused is reported as CLASS" \
  'Verdict: CLASS' "$tc" present

echo "-- $((checks - fails))/$checks checks pass"
if [[ "$fails" -gt 0 ]]; then echo "F2 PROBE TESTS FAILED: $fails"; exit 1; fi
echo ok
