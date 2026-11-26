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
  # `--` is load-bearing: patterns that start with a dash ('--glob', '--out')
  # were otherwise read as grep options, which makes the check red for a reason
  # that has nothing to do with the file.
  if grep -qE -- "$2" "$3"; then
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
expect "final: a refused read is not called a bad secret" "token-refused-at-read (token-rejected)" \
  "$("${V[@]}" final token-rejected ok not-run not-run mutate)" final "token-rejected ok not-run not-run mutate"
# The two blind-readback shapes. Each must NOT be one of the two conclusions it
# used to be able to print: "mutation-is-noop" (proven inert) and, worse,
# "project-token-can-deploy" (the trigger for swapping the release.yml legs).
expect "final: accepted with no baseline row to diff" "accepted-but-readback-blind (no-baseline-to-diff)" \
  "$("${V[@]}" final ok token-rejected accepted no-baseline-to-diff mutate)" final "ok token-rejected accepted no-baseline-to-diff mutate"
expect "final: accepted but the row watch was refused" "accepted-but-readback-blind (readback-unreadable)" \
  "$("${V[@]}" final ok ok accepted readback-unreadable mutate)" final "ok ok accepted readback-unreadable mutate"
for blind in no-baseline-to-diff readback-unreadable; do
  out="$("${V[@]}" final ok ok accepted "$blind" mutate)"
  checks=$((checks + 1))
  case "$out" in
    *project-token-can-deploy*|*mutation-is-noop*) echo "FAIL blind readback ($blind) printed $out"; fails=$((fails + 1));;
    *) echo "ok   blind readback ($blind) claims neither a deploy nor a no-op";;
  esac
done
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

# ---------------------------------------------------- verdicts vs. the doc table
# The drift this guards is one this repo actually shipped: `undecided (…)` was a
# verdict final_verdict could print and the operator's table had no row for it,
# because the table is hand-written prose and nothing compared the two. Now the
# names are read out of the classifier, so a branch with no documented meaning
# fails here instead of failing in front of somebody at 2 a.m.
doc_table=docs/ops/railway-f2-token-probe.md
emitted_verdicts=$(python3 - <<'PY'
import re
src = open("scripts/ci/f2-probe-verdict.py").read()
body = src.split("def final_verdict", 1)[1]
print("\n".join(sorted(set(re.findall(r'return f?"([a-z][a-z0-9_-]+)', body)))))
PY
)
# The TABLE, not the file. The first draft of this guard grepped the whole doc
# for each name and stayed green with the `undecided (…)` row deleted — the same
# word is a row of the ci-railway-token-class.yml verdict table further down. A
# check that passes while its own defect is installed is not a check, so the
# comparison is set equality against the rows under the PROBE_VERDICT header,
# in both directions: undocumented branch, and stale documented verdict.
documented_verdicts=$(awk '/^\| `PROBE_VERDICT`/{f=1;next} f && /^\|/{print} f && !/^\|/{f=0}' "$doc_table" \
  | sed -nE 's/^\| `([a-z0-9_-]+)( .*)?`.*/\1/p' | sort -u)
checks=$((checks + 1))
undocumented=$(comm -23 <(printf '%s\n' "$emitted_verdicts") <(printf '%s\n' "$documented_verdicts"))
if [[ -n "$undocumented" ]]; then
  echo "FAIL verdicts final_verdict can print with no doc row: $(printf '%s ' $undocumented)"; fails=$((fails + 1))
else
  echo "ok   every final_verdict branch has a row in the PROBE_VERDICT table"
fi
checks=$((checks + 1))
stale=$(comm -13 <(printf '%s\n' "$emitted_verdicts") <(printf '%s\n' "$documented_verdicts"))
if [[ -n "$stale" ]]; then
  echo "FAIL doc rows naming a verdict the classifier cannot print: $(printf '%s ' $stale)"; fails=$((fails + 1))
else
  echo "ok   the PROBE_VERDICT table documents no verdict that does not exist"
fi

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
# 2b. The credential KIND travels with the verdict. Raw `Authorization: Bearer`
#     refuses every project token on documents the same value answers through
#     `railway api`, so a `token-rejected` line is ambiguous unless the artifact
#     says which kind was asked — and the class lanes vs the transport lanes would
#     otherwise be indistinguishable after the fact. Checked as a block, not as a
#     word: a TOKEN_KIND assignment that no cell ever prints would score nothing.
kind_line=$(grep -nE '^TOKEN_KIND=' "$probe" | head -1)
checks=$((checks + 1))
if [[ -z "$kind_line" ]]; then
  echo "FAIL the probe never derives a credential kind"; fails=$((fails + 1))
elif ! grep -q "cut -c" <<<"$kind_line"; then
  echo "FAIL TOKEN_KIND is derived without a length cap, so it could print the secret"; fails=$((fails + 1))
else
  echo "ok   the credential kind is derived from a capped prefix, not the value"
fi
checks=$((checks + 1))
fn_block=$(awk '/^probe_service\(\) \{/{f=1} f&&/^\}/{exit} f' "$probe")
if grep -q 'PROBE_TOKEN_KIND' <<<"$fn_block"; then
  echo "ok   every probed service prints the credential kind before its cells"
else
  echo "FAIL the credential kind is computed but never printed with the cells"; fails=$((fails + 1))
fi
# And printing it must not be a way to print the token: no echo line may expand
# RAILWAY_TOKEN itself. Line 172's curl header and the mask's env assignment pass
# the value as an argument, which is not output, so those are not what this bans.
# [[:space:]] not \s, because the hygiene job's grep is BSD and has no \s.
checks=$((checks + 1))
if grep -nE '^[[:space:]]*echo [^#]*\$\{?RAILWAY_TOKEN' "$probe" > /tmp/f2-echo-token.txt; then
  echo "FAIL an echo expands the token itself:"
  sed -E 's/RAILWAY_TOKEN.*/RAILWAY_TOKEN<hidden>/' /tmp/f2-echo-token.txt | head -3
  fails=$((fails + 1))
else
  echo "ok   no echo can leak the token: the value reaches only curl and the masker"
fi
# 3. Each cell sends only its own declared variables. An undeclared extra is a
#    GraphQL validation error, and a silent 400 would read as a token answer.
bash "$probe" --check-documents > /tmp/f2-probe-docs.txt
want "auth document declares \$p" 'query\(\$p:String!\)' /tmp/f2-probe-docs.txt present
want "row document declares \$s and \$e" 'query\(\$s:String!,\$e:String!\)' /tmp/f2-probe-docs.txt present
want "deploy document declares \$latest" 'mutation\(\$s:String!,\$e:String!,\$latest:Boolean\)' /tmp/f2-probe-docs.txt present
want "sha deploy document declares \$s, \$e and \$sha" 'mutation\(\$s:String!,\$e:String!,\$sha:String!\)' /tmp/f2-probe-docs.txt present
# 3b. The spelling the mutation cell ACTUALLY sends is the sha one, and the
#     latestCommit document is kept only as a measured exclusion (owner-side
#     refusals since 2026-11-22T13:53Z make it unable to separate scope from
#     shape). The [^_] is what makes the exclusion mean something: without it the
#     pattern also matches the DOC_DEPLOY_SHA call site, and the absent check
#     would go red for a file that sends only the right document.
want "cell 3 sends the commitSha document" 'gql "\$DOC_DEPLOY_SHA"' "$probe" present
want "latestCommit is never sent" 'gql "\$DOC_DEPLOY"[^_]' "$probe" absent
want "the probe refuses mutate without a 40-hex sha" 'PROBE_REFUSED mutate-without-explicit-sha' "$probe" present
# 3c. A stub that answered any document would let a mismatched variable name pass
#     as a clean `accepted`: the cell-3 payload keys are proved here, not by a
#     text grep, because the fake edge compares each document's variable
#     signature against the variables the probe actually sent.
checks=$((checks + 1))
if grep -q 'def variable_drift' scripts/ci/f2-probe-stub.py; then
  echo "ok   the fake edge validates documents against their variables"
else
  echo "FAIL the fake edge answers documents without checking their variables"; fails=$((fails + 1))
fi
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
# The classifier cases above prove the MAPPING. The four scenarios below prove
# the SCRIPT: the transport, handing the HTTP code back out of the subshell,
# masking the token, and diffing a new row id against the baseline — the things
# that can print a confident wrong answer and are invisible to a payload test. The
# subshell one is not hypothetical: the first local run printed
# "auth=transport-error-no-response (http=)" under a body that parsed fine.
stub_out=/tmp/f2-probe-stub.out
run_stub() { # <scenario> <mode> [sha]  — pass "" as <sha> to test the refusal
  local sha=df667640637bdc7da783ecf3e15e35a59cbcee32
  [[ $# -ge 3 ]] && sha="$3"
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
  PROBE_DEPLOY_SHA="$sha" \
  PROBE_POLL_BUDGET_S=3 PROBE_POLL_INTERVAL_S=1 \
  PROBE_VERDICT_FILE=/tmp/f2-probe-verdict.test \
    bash "$probe" > /tmp/f2-probe-stub-run.out 2>&1
  local rc=$?
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  STUB_RC=$rc
}
contains() { # <label> <needle>
  checks=$((checks + 1))
  if grep -qF -- "$2" /tmp/f2-probe-stub-run.out; then echo "ok   $1";
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
contains "stub/unauthorized: does not claim a deploy" "token-refused-at-read (token-rejected)"
checks=$((checks + 1))
if grep -qF 'project-token-can-deploy' /tmp/f2-probe-stub-run.out; then
  echo "FAIL stub/unauthorized still printed the green verdict"; fails=$((fails + 1))
else
  echo "ok   stub/unauthorized never prints the green verdict"
fi
checks=$((checks + 1))
[[ "$STUB_RC" == 1 ]] && echo "ok   stub/unauthorized exits 1" || { echo "FAIL stub/unauthorized exit=$STUB_RC"; fails=$((fails + 1)); }

# The cell that decides everything, seen with no eyes on it: the reads work, the
# mutation says true, and the ROW QUERY afterwards is refused. Before the guard
# in cell 4 the empty id diffed against a real baseline as "a new row", so this
# shape could and did reach the green verdict. The two forbidden conclusions are
# asserted by name because they point at opposite actions: one proposes the
# release.yml swap, the other says the token is inert.
run_stub blind-readback mutate
contains "stub/blind: the reads and the mutation still behave" "PROBE_CELL mutation=accepted"
contains "stub/blind: cell 4 says the row query was refused" "read=token-rejected"
contains "stub/blind: cell 4 reports itself blind" "PROBE_CELL readback=readback-unreadable"
contains "stub/blind: the blind verdict" "PROBE_VERDICT[backend]=accepted-but-readback-blind (readback-unreadable)"
checks=$((checks + 1))
if grep -qE 'project-token-can-deploy|mutation-is-noop-for-project-token' /tmp/f2-probe-stub-run.out; then
  echo "FAIL stub/blind printed a deploy or an inert verdict from a refused row query"; fails=$((fails + 1))
else
  echo "ok   stub/blind claims neither a deploy nor a no-op"
fi

# The worst shape of the same defect, and the one that used to reach the green
# verdict: cell 2 is refused so base_id is empty, cell 4 then reads a real
# SUCCESS row that never existed before, and "" != that id reads as "new".
run_stub no-baseline mutate
contains "stub/no-baseline: the mutation still says true" "PROBE_CELL mutation=accepted"
contains "stub/no-baseline: cell 4 says there is nothing to diff" "PROBE_CELL readback=no-baseline-to-diff"
contains "stub/no-baseline: the blind verdict" "PROBE_VERDICT[backend]=accepted-but-readback-blind (no-baseline-to-diff)"
checks=$((checks + 1))
if grep -qF 'project-token-can-deploy' /tmp/f2-probe-stub-run.out; then
  echo "FAIL stub/no-baseline printed the green verdict from an un-comparable row"; fails=$((fails + 1))
else
  echo "ok   stub/no-baseline never prints the green verdict"
fi
checks=$((checks + 1))
[[ "$STUB_RC" == 0 ]] && echo "ok   stub/no-baseline exits 0 (auth passed; only the diff is blind)" \
  || { echo "FAIL stub/no-baseline exit=$STUB_RC"; fails=$((fails + 1)); }

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

# 5b. The sha guard, proven by running it instead of reading it. GitHub shows
#     every sha shortened to 9 in its own UI, so "paste what you see in the
#     Actions list" is the operator mistake this guard exists for; and an absent
#     sha is the dispatch form left half-filled. All three bad shapes must
#     refuse BEFORE the first query: a probe that could deploy "whatever main is
#     doing right now" is a probe that releases an unreviewed tree.
#     The forbidden evidence is cell output. The guard fires ahead of every
#     request, so any PROBE_CELL line here means a deploy mutation went out from
#     a run that had no commit to name — which is a release, not a measurement.
for bad_sha in '' df6676406 deadz000000000000000000000000000000000000; do
  run_stub ok mutate "$bad_sha"
  checks=$((checks + 1))
  if grep -qE 'PROBE_CELL|PROBE_VERDICT' /tmp/f2-probe-stub-run.out; then
    echo "FAIL sha='${bad_sha:0:12}' sent cells from a mutate run with no pinned commit"
    fails=$((fails + 1))
  else
    echo "ok   sha='${bad_sha:0:12}…' refused before the first query"
  fi
  checks=$((checks + 1))
  if [[ "$STUB_RC" == 2 ]]; then
    echo "ok   sha='${bad_sha:0:12}…' exits 2 (a refusal, not a silent pass)"
  else
    echo "FAIL sha='${bad_sha:0:12}…' exit=$STUB_RC, expected 2"; fails=$((fails + 1))
  fi
done
checks=$((checks + 1))
if grep -qE 'PROBE_REFUSED mutate-without-explicit-sha' /tmp/f2-probe-stub-run.out; then
  echo "ok   the refusal prints its own reason line"
else
  echo "FAIL the refusal was silent about why it refused"; fails=$((fails + 1))
fi

# 6. The dispatch form must actually reach the script. A job env key the script
#    never reads is silently ignored, so `service=frontend-web` would probe
#    backend and print a confident answer to a question nobody asked. This was
#    a real bug in the first version: the workflow exported SERVICE_NAME while
#    the script reads PROBE_SERVICE_NAME.
#    Regex, not PyYAML: this job's python3 has no third-party packages.
#    The input-name class includes "_" and that is load-bearing: `deploy_sha`
#    and `write_cell` are underscored, so the earlier `[a-z-]` silently matched
#    nothing on them — the wiring a reviewer most needs to see was invisible to
#    the checker, and the count printed 2 mappings for a 3-mapping file.
maps=$(sed -nE 's/^[[:space:]]+([A-Z_]+):[[:space:]]*\$\{\{ github\.event\.inputs\.([a-z_-]+) \}\}[[:space:]]*$/\1 \2/p' "$wf")
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
# One more, in the other direction: an input the form offers but nothing
# forwards is a field the operator can fill and GitHub can silently ignore. This
# is the same class of bug as the SERVICE_NAME one above, seen from the form
# instead of from the script — and `deploy_sha` is precisely the field where an
# ignored value would turn "no commit named" into "the guard fired", which a
# reader could mistake for a token answer.
map_inputs=$(printf '%s\n' "$maps" | awk '{print $2}' | sort -u)
decl_inputs=$(awk 'BEGIN{f=0} /^    inputs:/{f=1;next} /^permissions:/{f=0}
  f && /^      [a-z_-]+:$/ {k=$1; sub(/:$/,"",k); print k}' "$wf" | sort -u)
unused=""
while read -r d; do
  [[ -z "$d" ]] && continue
  grep -qx -- "$d" <<<"$map_inputs" || unused="$unused $d"
done <<<"$decl_inputs"
checks=$((checks + 1))
if [[ -n "$unused" ]]; then
  echo "FAIL dispatch input(s)$unused are declared on the form but never forwarded"; fails=$((fails + 1))
else
  echo "ok   every declared dispatch input is forwarded to the script ($(printf '%s\n' "$decl_inputs" | grep -c .) inputs)"
fi

# 6b. The "Verdict" step cats a hardcoded path; the script writes
#     ${PROBE_VERDICT_FILE:-/tmp/f2-probe-verdict}. If those two literals ever
#     drift, the summary prints "No verdict written" after a run that actually
#     produced one — a silent loss of the only deliverable.
verdict_default=$(sed -nE 's/^VERDICT_FILE="\$\{PROBE_VERDICT_FILE:-([^}]+)\}"$/\1/p' "$probe")
checks=$((checks + 1))
if [[ -n "$verdict_default" ]] && grep -qF -- "$verdict_default" "$wf"; then
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

# ------------------------------------------------------------- token-class
# Two files answer one question: ci-railway-token-class.yml SAMPLES the three
# project tokens plus an anonymous control, read-only, and
# scripts/ci/f2-token-class-verdict.py DECIDES what the samples mean. The split
# is the point: the rules have to be drivable from recorded sample sets, because
# inside a runner they are only ever executed while holding live credentials.
tc=.github/workflows/ci-railway-token-class.yml
tcs=scripts/ci/f2-token-class-verdict.py
for f in "$tc" "$tcs"; do
  checks=$((checks + 1))
  if [[ -f "$f" ]]; then echo "ok   $f exists"; else echo "FAIL $f missing"; fails=$((fails + 1)); fi
done

# --- safety invariants of the sampler: the reads cannot write, and the one step
#     that can is gated three ways at once — a default-off checkbox, an exact
#     commit, and a hardcoded staging target.
want "token-class: dispatch-only, nothing can reach it by pushing" \
  '^[[:space:]]*(push|schedule|pull_request|release):' "$tc" absent
want "token-class: entry point is workflow_dispatch" 'workflow_dispatch' "$tc" present
want "token-class: repository guard present" 'if: github.repository ==' "$tc" present
# The load-bearing default: PROBE_MODE at job level must stay the literal
# read-only, so every step that does not override it is a read. The override is
# what this section is now about, and it is checked structurally below rather
# than by banning the word — the earlier version of this file asserted
# "the word 'mutate' appears nowhere", which a green suite could keep satisfying
# only by having no write cell at all, i.e. by not answering the question.
want "token-class: job default mode is the literal read-only" \
  '^[[:space:]]+PROBE_MODE: read-only[[:space:]]*$' "$tc" present
# The dispatch form may steer exactly two things, and neither names a target.
want "token-class: no environment or service input" \
  '^[[:space:]]+(environment|environment_id|service|service_name|target):' "$tc" absent
want "token-class: the write cell needs a full 40-hex sha" '\^\[0-9a-f\]\{40\}\$' "$tc" present
want "token-class: the write cell is not reachable without the checkbox" \
  '^[[:space:]]+if: inputs\.write_cell[[:space:]]*$' "$tc" present
want "token-class: the checkbox is default off" \
  '^[[:space:]]+default: false[[:space:]]*$' "$tc" present
# latestCommit is the shape that cannot separate scope from shape (three owner
# refusals before a commitSha `true` minutes later), so no CI step may use it.
want "token-class: nothing asks for latestCommit" 'latestCommit|latest_commit|LATEST_COMMIT' "$tc" absent
# One write step, bounded: gated, staging credential only, cli transport, sha
# from the form. Extracted as a line range so "the staging token appears in the
# file" cannot satisfy it — that is true of the read cells too.
wc_start=$(grep -nE "^[[:space:]]+- name: 'write cell - staging" "$tc" | head -1 | cut -d: -f1)
wc_next=$(awk -v s="${wc_start:-0}" 'NR>s && /^[[:space:]]+- name:/ && !/write cell - staging/ {print NR; exit}' "$tc")
wc_block=$(awk -v a="${wc_start:-0}" -v b="${wc_next:-0}" \
  'NR>=a && (b==0 || NR<b)' "$tc")
wc_n=$(grep -cE '^[[:space:]]+PROBE_MODE: mutate[[:space:]]*$' "$tc")
checks=$((checks + 1))
if [[ -z "$wc_start" || "$wc_n" != 1 ]]; then
  echo "FAIL token-class: expected exactly one PROBE_MODE: mutate step, found $wc_n"; fails=$((fails + 1))
else
  wc_ok=1; wc_why=""
  for needle in 'if: inputs.write_cell' 'RAILWAY_TOKEN_STAGING' 'PROBE_MODE: mutate' \
                'PROBE_TRANSPORT: cli' 'PROBE_DEPLOY_SHA: ${{ inputs.deploy_sha }}' '|| true'; do
    grep -qF -- "$needle" <<<"$wc_block" || { wc_ok=0; wc_why="is missing '$needle'"; }
  done
  if grep -qE 'RAILWAY_TOKEN_(DEVELOPMENT|PRODUCTION)' <<<"$wc_block"; then
    wc_ok=0; wc_why="names a credential other than staging's"
  fi
  if [[ "$wc_ok" == 1 ]]; then
    echo "ok   token-class: the single write step is gated, staging-only, cli, sha-from-form, failure-tolerant"
  else
    echo "FAIL token-class: the write step $wc_why"; fails=$((fails + 1))
  fi
fi
# And the form itself may offer nothing else: an undeclared input is silently
# ignored, a declared-but-unread one is a lie on the dispatch page.
decl=$(awk '/^    inputs:/{f=1;next} /^permissions:/{f=0} f && /^      [a-z_-]+:$/ {sub(/:$/,"",$1); print $1}' "$tc" | sort | tr '\n' ' ')
checks=$((checks + 1))
if [[ "$decl" == "deploy_sha write_cell " ]]; then
  echo "ok   token-class: the dispatch form declares only write_cell and deploy_sha"
else
  echo "FAIL token-class: declared inputs are '$decl'"; fails=$((fails + 1))
fi
for s in RAILWAY_TOKEN_DEVELOPMENT RAILWAY_TOKEN_STAGING RAILWAY_TOKEN_PRODUCTION; do
  want "token-class: uses $s" "$s" "$tc" present
done
# A refused read is the ANSWER here. A step that stops on the first non-zero exit
# leaves the later credentials untested and the table half-filled — which reads
# exactly like "the class is fine, staging alone broke". Counted same-line
# against the probe call rather than as two totals, because the sampler's header
# documents this rule and a bare count would pass on the prose that explains it.
# Compared against the number of calls the file actually makes instead of a
# hard-coded 4: the workflow grew a second set of four (the cli-transport cells)
# and a literal would have made an honest addition look like a safety regression.
tc_calls=$(grep -Ec 'bash scripts/ci/f2-token-probe\.sh' "$tc")
tc_tolerant=$(grep -Ec 'f2-token-probe\.sh.*\|\| true' "$tc")
checks=$((checks + 1))
if [[ "$tc_calls" -ge 8 && "$tc_calls" == "$tc_tolerant" ]]; then
  echo "ok   token-class: all $tc_calls probe calls tolerate a refused read"
else
  echo "FAIL token-class: $tc_tolerant of $tc_calls probe calls tolerate a non-zero exit"; fails=$((fails + 1))
fi
# The empty-credential control is what makes "Not Authorized" mean something:
# Railway answers HTTP 200 for auth failures, so a bad token and no token look
# identical unless both run against the same document.
want "token-class: an empty-credential control exists" "RAILWAY_TOKEN: ''" "$tc" present
# One read per credential cannot carry a three-way answer. Both #1143 runs
# refused the staging token on every cell (read-only 09:49:38Z; write cell
# 09:57:10Z — `auth=token-rejected`, `mutation=token-rejected`), so agreement is
# the expected result, and agreement is precisely what one sample cannot
# demonstrate: a stable refusal looks identical to a transient edge or
# rate-limit refusal. So every credential is sampled PROBE_CLASS_REPEATS times.
want "token-class: the repeat count is declared" \
  '^[[:space:]]+PROBE_CLASS_REPEATS: 3[[:space:]]*$' "$tc" present
reps=$(grep -c 'for i in $(seq 1 "${PROBE_CLASS_REPEATS' "$tc")
checks=$((checks + 1))
if [[ "$reps" == 4 ]]; then
  echo "ok   token-class: all four credentials are sampled, not read once"
else
  echo "FAIL token-class: only $reps/4 credential steps loop"; fails=$((fails + 1))
fi
# Each attempt must land in its own file. Without the attempt index the tee
# overwrote itself, so a rate could never be anything but N/N and the mixed case
# this sampler exists to catch was invisible by construction.
want "token-class: each attempt writes its own file" \
  'class-\$\{CLASS_LABEL\}-\$\{i\}\.txt' "$tc" present

# --- the decider must be a script the sampler calls, not a heredoc
want "token-class: the sampler calls the decider" \
  'python3 scripts/ci/f2-token-class-verdict\.py' "$tc" present
want "token-class: no verdict rules embedded in the YAML" 'python3 - <<' "$tc" absent
# This used to pin `--glob /tmp/class-*.txt` — i.e. it pinned the UNQUOTED
# spelling, so the suite stayed green while run 45024735432 died in this very
# step ("unrecognized arguments", exit 2, after twelve good samples). What has to
# be true is that the decider is handed the files the sampler writes AND that the
# shell cannot word-split the pattern into eleven positional extras: the quoted
# form is the one that keeps both properties, and check (8) below fails if the
# quotes ever come off.
want "token-class: the sampler hands the decider its own files, quoted" \
  '--glob "/tmp/class-\*\.txt"' "$tc" present
want "token-class: the decider appends to the job summary" \
  '--out "\$GITHUB_STEP_SUMMARY"' "$tc" present
# The decider is pure: it reads files and renders text. If it grows a network
# call it runs with a live token in the environment of the step whose only job is
# to interpret.
want "token-class: the decider opens no connection" \
  'urllib|requests|httpx|socket|subprocess' "$tcs" absent

# --- behavioural cases: recorded sample sets in, rendered verdicts out
classd=$(mktemp -d)
mkrows() { # <label> <auth> [<auth> …] — one file per attempt; baseline always ok
  local label="$1" n=0 a
  shift
  for a in "$@"; do
    n=$((n + 1))
    { echo "CLASS_CELL label=${label} attempt=${n}"
      echo "PROBE_CELL auth=${a} (http=200)"
      echo "PROBE_CELL baseline=ok (http=200)"
    } > "${classd}/class-${label}-${n}.txt"
  done
}
run_class() { python3 "$tcs" --glob "${classd}/class-*.txt" 2>&1; }
reset_class() { rm -f "${classd}"/class-*.txt; }
expect_verdict() { # <label> <expected substring> <forbidden substring>
  checks=$((checks + 1))
  local label="$1"
  local out; out=$(run_class)
  local n; n=$(printf '%s\n' "$out" | grep -c '^\*\*Verdict:')
  if [[ "$n" != 1 ]]; then
    echo "FAIL $label: $n verdict lines, expected exactly 1"; fails=$((fails + 1))
    printf '%s\n' "$out" | sed 's/^/         /' | head -8
    return
  fi
  if ! printf '%s\n' "$out" | grep -qF -- "$2"; then
    echo "FAIL $label: expected '$2'"; fails=$((fails + 1))
    printf '%s\n' "$out" | grep '^\*\*Verdict:' | sed 's/^/         /'
    return
  fi
  if [[ -n "$3" ]] && printf '%s\n' "$out" | grep -qF -- "$3"; then
    echo "FAIL $label: must not also say '$3'"; fails=$((fails + 1)); return
  fi
  echo "ok   $label"
}
expect_cell() { # <label> <credential> <expected substring in that row>
  checks=$((checks + 1))
  local label="$1"
  local line; line=$(run_class | grep "^| \`$2\`" | head -1)
  if printf '%s\n' "$line" | grep -qF -- "$3"; then
    echo "ok   $label"
  else
    echo "FAIL $label: the row reads '${line:-<absent>}'"; fails=$((fails + 1))
  fi
}

# (1) development authenticates 3/3 while staging is refused 3/3: one secret is
#     the variable, not the class.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development ok ok ok
mkrows staging token-rejected token-rejected token-rejected
mkrows production token-rejected token-rejected token-rejected
expect_cell "cell: a 0/3 credential shows three attempts and the rate" staging \
  '**0/3 all-refused**'
expect_verdict "verdict: dev 3/3 ok + staging 0/3 = VALUE" "Verdict: VALUE, not class." INTERMITTENT

# (2) every token refused: the class cannot reach the graph whatever the values.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development token-rejected token-rejected token-rejected
mkrows staging token-rejected token-rejected token-rejected
mkrows production token-rejected token-rejected token-rejected
expect_verdict "verdict: all three refused = CLASS" "Verdict: CLASS." "Verdict: VALUE"

# (3) the mixed shape: refused, then accepted. NOT observed — both #1143 runs
#     refused every cell — but this is the branch that must exist before a
#     single inconsistent reading can be mistaken for a reason to rotate a
#     secret, so it is exercised here with recorded rows.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development ok ok ok
mkrows staging token-rejected ok ok
mkrows production ok ok ok
expect_cell "cell: a mixed credential keeps all three attempts" staging '**2/3 mixed**'
expect_verdict "verdict: mixed attempts = INTERMITTENT" "Verdict: INTERMITTENT" "Verdict: VALUE"
checks=$((checks + 1))
if run_class | grep -qF 'Do NOT rotate the secret'; then
  echo "ok   verdict: INTERMITTENT forbids the destructive guess"
else
  echo "FAIL verdict: INTERMITTENT does not forbid rotating the secret"; fails=$((fails + 1))
fi

# (4) an authenticating control means a token and no token looked identical, so
#     nothing else in the table is evidence. This is the ordering check: CONTROL
#     outranks INTERMITTENT, which outranks VALUE and CLASS.
reset_class
mkrows anonymous ok ok ok
mkrows development ok ok ok
mkrows staging token-rejected ok token-rejected
mkrows production token-rejected token-rejected token-rejected
expect_verdict "verdict: an authenticating control outranks everything" \
  "Verdict: CONTROL BROKEN." "Verdict: INTERMITTENT"

# (5) both tokens clean contradicts the read-only run — say that, do not pick a
#     side of the argument.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development ok ok ok
mkrows staging ok ok ok
mkrows production ok ok ok
expect_verdict "verdict: dev and staging both clean = neither" "Verdict: neither." "Verdict: CLASS"

# (6) a credential that never wrote a row is not evidence of refusal. Without
#     this the CLASS branch reads a crashed step as an answer.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development token-rejected token-rejected token-rejected
mkrows production token-rejected token-rejected token-rejected
expect_verdict "verdict: a missing credential is undecided, not CLASS" \
  "Verdict: undecided" "Verdict: CLASS"
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
expect_verdict "verdict: the control alone answers nothing" "Verdict: undecided" "Verdict: CLASS"
# (7) the ARGUMENT SHAPE, not only the rules. Everything above calls this script
#     with a QUOTED glob, which is the spelling that works; run 45024735432 ran it
#     with the workflow's UNQUOTED glob, and the runner's shell handed argparse
#     twelve words — exit 2, "unrecognized arguments", twelve sampled cells and no
#     verdict. A suite that only ever exercises the convenient spelling cannot see
#     that, so this case expands the glob on purpose and compares.
reset_class
mkrows anonymous token-rejected token-rejected token-rejected
mkrows development ok ok ok
mkrows staging token-rejected token-rejected token-rejected
mkrows production token-rejected token-rejected token-rejected
quoted=$(python3 "$tcs" --glob "${classd}/class-*.txt" 2>&1)
rc_q=$?
# Deliberately unquoted: this is the spelling that killed the live job.
unquoted=$(python3 "$tcs" --glob ${classd}/class-*.txt 2>&1)
rc_u=$?
checks=$((checks + 1))
if [[ "$rc_u" == "0" ]]; then
  echo "ok   arg shape: an expanded glob still exits 0 (quoted rc=$rc_q, expanded rc=$rc_u)"
else
  echo "FAIL arg shape: expanded glob exits $rc_u — this is exactly where run 45024735432 died"; fails=$((fails + 1))
fi
checks=$((checks + 1))
nv=$(printf '%s\n' "$unquoted" | grep -c '^\*\*Verdict:')
if [[ "$nv" == "1" ]]; then
  echo "ok   arg shape: an expanded glob prints exactly one verdict"
else
  echo "FAIL arg shape: expanded glob printed $nv verdict lines"; fails=$((fails + 1))
fi
checks=$((checks + 1))
if [[ "$quoted" == "$unquoted" ]]; then
  echo "ok   arg shape: both spellings answer identically"
else
  echo "FAIL arg shape: quoted and expanded globs disagree — one of them is reading a subset"; fails=$((fails + 1))
  diff <(printf '%s\n' "$quoted") <(printf '%s\n' "$unquoted") | sed 's/^/         /' | head -8
fi

# (8) the workflow must not silently re-introduce the unquoted line. The mutation
#     proof: delete the quotes from ci-railway-token-class.yml:144 and this check
#     goes red while every classifier check stays green.
checks=$((checks + 1))
if grep -qE '^[[:space:]]*--glob "/tmp/class-\*\.txt"' "$tc"; then
  echo "ok   workflow: the Verdict step quotes its glob"
else
  echo "FAIL workflow: the Verdict step passes an unquoted glob — the shell expands it and the verdict dies"; fails=$((fails + 1))
  grep -n 'class-verdict.py\|--glob' "$tc" | sed 's/^/         /'
fi
checks=$((checks + 1))
if grep -qF -- 'already-expanded sample paths' "$tcs"; then
  echo "ok   workflow: the script still accepts the expanded spelling as a backstop"
else
  echo "FAIL workflow: the positional backstop is gone, so a quoting slip silences the verdict again"; fails=$((fails + 1))
fi
# ------------------------------------------------- (9) the status decode probe
# WHY THIS EXISTS AT ALL. Six staging dispatches of ops-railway-upload.yml
# (45029642480 … 45030326422, 2026-11-22 13:51Z/13:59Z) died 0.3 s into their own
# pre-flight — `railway status --json` — printing F2's string:
#   Failed to fetch: error decoding response body
# while `railway api` with the same token on the same runner decodes fine and
# answers `Not Authorized`. So the decode refusal is not upload-specific, and the
# question the answer turns on is which credential classes can decode that
# response. Locally, pinned 5.40.1 with the owner's USER token exits 0 with
# 213,691 bytes of JSON, so the CLI version alone is exonerated and only a runner
# holding a PROJECT token can settle it. That is scripts/ci/f2-status-probe.sh,
# and because a runner is the only place it can run, the classification below is
# what makes its output checkable afterwards.
#
# Convention: `status <rc> <stdout> <stderr>`. Order matters — rc=124 is a
# timeout before it is anything else, and rc=0 with no bytes is NOT a decode.
expect "status: exit 0 with parseable JSON" "decoded" \
  "$("${V[@]}" status 0 '{"environments":{"edges":[]}}' '')" \
  status "0 '{\"environments\"...}' ''"
# The realistic shape: this workspace's status body carries project,
# environments and services. Held in a variable because the inline spelling above
# is fine while a nested-quote spelling in the same position silently reaches the
# classifier as text — the payload, not the parser, was the bug here.
STATUS_BIG='{"project":{"id":"e7dca861"},"environments":{"edges":[{"node":{"name":"staging"}}]},"services":[]}'
expect "status: exit 0 with a huge real-shaped body" "decoded" \
  "$("${V[@]}" status 0 "$STATUS_BIG" '')" \
  status "0 project+environments ''"
# The measured CI shape, verbatim from job 137230172408.
expect "status: the measured F2 decode refusal" "decode-refused" \
  "$("${V[@]}" status 1 '' 'Failed to fetch: error decoding response body
    0: error decoding response body')" \
  status "1 '' 'Failed to fetch: error decoding response body'"
# RED CONTROL: this must not read green, whatever the classifier does next.
checks=$((checks + 1))
if [[ "$("${V[@]}" status 1 '' 'Failed to fetch: error decoding response body')" != "decoded" ]]; then
  echo "ok   status red control: a decode refusal never reads as decoded"
else
  echo "FAIL status red control: a decode refusal read as 'decoded' — the classifier trusts rc or presence alone"; fails=$((fails + 1))
fi
expect "status: an HTML body at exit 1" "non-json-body" \
  "$("${V[@]}" status 1 '<html><title>502 Bad Gateway</title></html>' '')" \
  status "1 '<html>…502…' ''"
expect "status: exit 0 that wrote nothing" "empty-body" \
  "$("${V[@]}" status 0 '' '')" status "0 '' ''"
expect "status: truncated JSON (a body cut mid-write)" "truncated-json" \
  "$("${V[@]}" status 0 '{"environments":{"edges":[' '')" \
  status "0 '{\"environments\":{\"edges\":[' ''"
expect "status: the runner was never linked" "not-linked" \
  "$("${V[@]}" status 1 '' 'Error: No project linked. Run `railway link` to connect to a project.')" \
  status "1 '' 'No project linked'"
expect "status: a credential the API rejects outright" "unauthorized" \
  "$("${V[@]}" status 1 '' 'Error: Unauthorized. Please check your token.')" \
  status "1 '' 'Unauthorized'"
expect "status: the CLI hung and timed out" "timeout-no-response" \
  "$("${V[@]}" status 124 '' '')" status "124 '' ''"
expect "status: exit 0 but the body says Not Authorized" "token-rejected" \
  "$("${V[@]}" status 0 '{"errors":[{"message":"Not Authorized","extensions":{"code":"INTERNAL_SERVER_ERROR"}}],"data":null}' '')" \
  status "0 errors:Not Authorized ''"
expect "status: an unexplained exit is not a verdict" "other-failure" \
  "$("${V[@]}" status 3 '' 'some unrelated CLI complaint')" status "3 '' 'unrelated'"

# The probe script and the workflow that runs it.
sp=scripts/ci/f2-status-probe.sh
checks=$((checks + 1))
if [[ -f "$sp" ]]; then
  echo "ok   status probe: scripts/ci/f2-status-probe.sh exists"
else
  echo "FAIL status probe: $sp is missing — the classifier has nothing to drive it"; fails=$((fails + 1))
fi
if [[ -f "$sp" ]]; then
  want "status probe: it calls the classifier, not its own inline rules" 'f2-probe-verdict.py' "$sp" present
  want "status probe: the pinned CLI version is an override, not a guess" 'PROBE_RAILWAY_VERSION' "$sp" present
  want "status probe: the runner CLI matches the ops lane's 5.40.1" '5\.40\.1' "$sp" present
  want "status probe: it bounds the call with timeout" '\btimeout ' "$sp" present
  want "status probe: it never prints the token" 'printf.*RAILWAY_TOKEN' "$sp" absent
  want "status probe: it masks the credential in its own banner" 'masked|MASKED' "$sp" present
  want "status probe: stdout goes to a file, not straight to the classifier" 'status-out\.json' "$sp" present
  want "status probe: it reports the byte count it saw" 'wc -c' "$sp" present
fi
want "workflow: the class probe runs the status cell too" 'f2-status-probe\.sh' "$tc" present
want "workflow: status cells land in their own files" '/tmp/status-' "$tc" present
want "workflow: the status summary globs quoted" '"\$GITHUB_STEP_SUMMARY"' "$tc" present
want "workflow: the status probe is installed at the pinned version" 'npm install --global' "$tc" present
# ------------------------------------------------ (10) the status verdict rules
# WHY THE RULES ARE A FILE AND NOT A HEREDOC. ci-railway-token-class.yml used to
# build this comparison inside a `python3 - <<'PY'` block. That made the
# four-way choice (class fault / staging-only payload / upload-path-only /
# incomplete run) untestable, because the only machine that ever ran it also
# held three live credentials. Run 45024735432 is the precedent from section 7:
# one quoting mistake in a heredoc rule silenced the class verdict on a run
# whose twelve samples were all fine. So the rules live in
# scripts/ci/f2-status-verdict.py, take recorded cells, and the workflow calls
# them — which is only worth something if this file drives them.
echo
echo "--- f2-status-verdict.py: recorded cells in, comparison and verdict out"
sv=scripts/ci/f2-status-verdict.py
checks=$((checks + 1))
if [[ -f "$sv" ]]; then
  echo "ok   the status verdict rules are a file the workflow calls"
else
  echo "FAIL $sv is missing — the rules went back into a workflow heredoc"; fails=$((fails + 1))
fi
svd=$(mktemp -d)

# Shapes copied from f2-status-probe.sh's own echo lines. The `cli= rc= bytes=
# verdict=` quadruple really is ONE line, and `first=` really does contain
# spaces. A fixture that invents a tidier format tests the fixture and not the
# reader, which is how the first version of this file reported every live cell
# as `verdict=missing` and still printed a confident paragraph.
svcell() { # <label> <present> <rc> <bytes> <verdict> [first]
  {
    echo "STATUS_CELL_BEGIN label=$1"
    echo "STATUS_CELL credential=masked=yes present=$2"
    echo "STATUS_CELL cli=5.40.1 rc=$3 bytes=$4 verdict=$5"
    [[ -n "${6:-}" ]] && echo "STATUS_CELL first=$6"
    echo "STATUS_CELL_END label=$1"
  } > "$svd/status-$1.txt"
}
svclear() { rm -f "$svd"/status-*.txt; }
svout() { python3 "$sv" --glob "$svd/status-*.txt"; }
svsay() { # <label> <needle that must appear>
  checks=$((checks + 1))
  local out; out=$(svout)
  if grep -qF -- "$2" <<<"$out"; then
    echo "ok   $1"
  else
    echo "FAIL $1: no '$2' in the summary"; sed 's/^/         /' <<<"$out"; fails=$((fails + 1))
  fi
}
svquiet() { # <label> <needle that must NOT appear>
  checks=$((checks + 1))
  local out; out=$(svout)
  if grep -qF -- "$2" <<<"$out"; then
    echo "FAIL $1: the summary says '$2' anyway"; sed 's/^/         /' <<<"$out"; fails=$((fails + 1))
  else
    echo "ok   $1"
  fi
}
REFUSED="Failed to fetch: error decoding response body"

# Case A — what the six dead staging dispatches predict, now on every
# credential: a project token in a runner cannot decode a plain read any better
# than it can decode an upload. That is the repro the support thread needs, and
# development's green upload legs are what makes it a credential finding rather
# than a staging finding.
svclear
svcell anonymous no 1 0 decode-refused "$REFUSED"
svcell development yes 1 0 decode-refused "$REFUSED"
svcell staging yes 1 0 decode-refused "$REFUSED"
svcell production yes 1 0 decode-refused "$REFUSED"
svsay "cells: uniform refusal reads as F2 on a plain read, with a repro" "two-line repro"
svquiet "cells: a uniform refusal is not softened into a staging-only story" "Only staging refuses"

# Case B — what the laptop control predicts: every credential decodes, so the
# pre-flight deaths are some other fault and F2 stays upload-specific.
svclear
svcell anonymous yes 0 213691 decoded
svcell development yes 0 213691 decoded
svcell staging yes 0 213691 decoded
svcell production yes 0 213691 decoded
svsay "cells: all-decoded reads as upload-path-only, not a proof of health" \
  "confined to the upload request path"
svquiet "cells: all-decoded does not claim the class fault" "two-line repro"

# Case C — staging alone: the one result that re-opens rotating the secret, so
# it must name the environment and must not claim a class fault.
svclear
svcell anonymous yes 0 213691 decoded
svcell development yes 0 213691 decoded
svcell staging yes 1 0 decode-refused "$REFUSED"
svcell production yes 0 213691 decoded
svsay "cells: staging-only refusal names the environment" "Only staging refuses"
svquiet "cells: a staging-only refusal is not reported as a class fault" "two-line repro"

# Case D — RED CONTROL. Two decoded cells, one refused cell, and a production
# cell that never arrived. Case C's sentence is the wrong answer here: with
# production unmeasured, "only staging refuses" is a guess about a row nobody
# read. This is the check that keeps the rules honest, and it is the one that
# would have caught a `refused == ["staging"]` condition written without
# `complete and`.
svclear
svcell anonymous yes 0 213691 decoded
svcell development yes 0 213691 decoded
svcell staging yes 1 0 decode-refused "$REFUSED"
svquiet "cells: a missing production cell blocks the staging-only story (red control)" \
  "Only staging refuses"
svsay "cells: a missing cell is shown as missing" "cell missing"

# Case E — three decoded, one absent: reads like case B at a glance, and case
# B is the sentence that would justify closing F2 as upload-only.
svclear
svcell anonymous yes 0 213691 decoded
svcell development yes 0 213691 decoded
svcell staging yes 0 213691 decoded
svquiet "cells: an incomplete run never reads as upload-path-only (red control)" \
  "confined to the upload request path"
svsay "cells: an incomplete run says an unmeasured cell is not a passing cell" \
  "unmeasured cell is not a passing cell"

# Case F — nothing collected at all: the install step died, and an empty table
# must be reported as "the probe never ran", not as agreement between cells.
svclear
svsay "cells: an empty collection says the probe never ran" \
  "No status cells were collected"

# Case G — the control refusing while every token decodes does not invalidate
# the token rows, but "decode-refused" stops being attributable to credentials,
# so the run has to say so out loud.
svclear
svcell anonymous yes 1 0 decode-refused "$REFUSED"
svcell development yes 0 213691 decoded
svcell staging yes 0 213691 decoded
svcell production yes 0 213691 decoded
svsay "cells: a control that refuses in the credential words is called broken" "CONTROL BROKEN"

# Safety: the summary is written with --out exactly like $GITHUB_STEP_SUMMARY,
# and it must carry the masked marks and the CLI's sentence and nothing that
# looks like a credential (ra_ and rlwy_ are Railway's token prefixes).
# The payloads are shaped but not real, and they say FAKE in the value:
# the point of the case is that the renderer must redact them.
svclear
svcell staging yes 1 0 decode-refused "$REFUSED"
printf 'STATUS_CELL_BEGIN label=leak\nSTATUS_CELL credential=masked=yes present=yes\nSTATUS_CELL cli=5.40.1 rc=1 bytes=0 verdict=decode-refused\nSTATUS_CELL first=ra_FAKEfakefake rlwy_proj_FAKEfakefake\nSTATUS_CELL_END label=leak\n' > "$svd/status-leak.txt"
python3 "$sv" --glob "$svd/status-*.txt" --out "$svd/summary.md"
checks=$((checks + 1))
if grep -q 'masked=yes' "$svd/summary.md" \
   && ! grep -qE 'ra_[a-zA-Z0-9]{4}|rlwy_[a-zA-Z0-9]{4}' "$svd/summary.md"; then
  echo "ok   safety: the summary carries masked marks only, never a credential"
else
  echo "FAIL safety: something credential-shaped reached the summary"
  sed 's/^/         /' "$svd/summary.md"; fails=$((fails + 1))
fi

# The first-line field is the one place a body fragment is echoed on purpose, so
# it must stay bounded — an unbounded `first=` would paste the whole refusal
# response into the run summary.
checks=$((checks + 1))
if grep -qE -- 'STATUS_CELL first=\$\{head\}.*cut -c|head -1 "\$ERR" \| cut' scripts/ci/f2-status-probe.sh; then
  echo "ok   safety: the probe truncates the CLI's first line before printing it"
else
  echo "FAIL safety: f2-status-probe.sh prints an unbounded first line"; fails=$((fails + 1))
fi

# Arg shape: quoted glob and an already-expanded list must agree, because the
# class verdict learned that the hard way in section 7.
svclear
svcell staging yes 1 0 decode-refused "$REFUSED"
checks=$((checks + 1))
sq=$(python3 "$sv" --glob "$svd/status-*.txt")
su=$(python3 "$sv" "$svd/status-staging.txt")
if [[ "$sq" == "$su" ]]; then
  echo "ok   arg shape: quoted glob and expanded paths answer identically"
else
  echo "FAIL arg shape: the two spellings disagree, so one reads a subset"
  diff <(printf '%s\n' "$sq") <(printf '%s\n' "$su") | sed 's/^/         /' | head -6
  fails=$((fails + 1))
fi

# The workflow must CALL the file rather than re-inline the rules, or the rules
# this suite drives stop being the rules that run.
want "workflow: the status verdict calls the rules file" 'python3 scripts/ci/f2-status-verdict.py' "$tc" present
want "workflow: the status verdict quotes its glob" '--glob "/tmp/status-\*\.txt"' "$tc" present
checks=$((checks + 1))
if grep -qE -- "<<'PY'" "$tc"; then
  echo "FAIL workflow: a python heredoc is back in ci-railway-token-class.yml — its rules are untestable again"
  grep -nE -- "<<'PY'" "$tc" | sed 's/^/         /'
  fails=$((fails + 1))
else
  echo "ok   workflow: no python heredoc, so every rule in this job is offline-tested"
fi
rm -rf "$svd"

# ------------------------------------------------------------------ transport
# (11) the curl-vs-CLI comparison, and the two measurement fixes it forced
echo "--- f2-transport-verdict.py: same document, two clients, compared per credential"
tv=scripts/ci/f2-transport-verdict.py
tvd=$(mktemp -d)
checks=$((checks + 1))
if [[ -f "$tv" ]]; then
  echo "ok   the transport comparison is a file the workflow calls"
else
  echo "FAIL $tv is missing — the comparison went back into a heredoc"; fails=$((fails + 1))
fi

# Cell shapes copied from f2-token-probe.sh's own output. The curl side really is
# one file PER ATTEMPT (`class-<label>-<n>.txt`, written by the loop in the
# workflow step) and the cli side one PER CREDENTIAL (`cli-<label>.txt`), so a
# fixture that tidies that up tests the fixture and not the reader.
tvreset() { rm -f "$tvd"/class-*.txt "$tvd"/cli-*.txt; }
tvcurl() { # <label> <attempt> <auth>
  {
    echo "CLASS_CELL label=$1 attempt=$2"
    echo "PROBE_CELL auth=$3 (http=200)"
    echo "PROBE_CELL baseline=$3 row= status="
  } > "$tvd/class-$1-$2.txt"
}
tvcli() { # <label> <auth>
  {
    echo "CLASS_CELL label=$1 attempt=1"
    echo "PROBE_CELL auth=$2 (http=cli-transport)"
    echo "PROBE_CELL baseline=$2 row= status="
  } > "$tvd/cli-$1.txt"
}
tvout() { python3 "$tv" --curl-glob "$tvd/class-*.txt" --cli-glob "$tvd/cli-*.txt"; }
tvsay() { # <label> <needle that must appear>
  checks=$((checks + 1))
  local out; out=$(tvout)
  if grep -qF -- "$2" <<<"$out"; then
    echo "ok   $1"
  else
    echo "FAIL $1: no '$2' in the summary"; sed 's/^/         /' <<<"$out" | tail -8; fails=$((fails + 1))
  fi
}
tvnot() { # <label> <needle that must NOT appear>
  checks=$((checks + 1))
  local out; out=$(tvout)
  if grep -qF -- "$2" <<<"$out"; then
    echo "FAIL $1: '$2' appeared, and someone would act on it"; fails=$((fails + 1))
  else
    echo "ok   $1"
  fi
}
tvall() { # <curl-auth> <cli-auth> — three tokens, plus a control refused on both
  tvreset
  local lab
  for lab in development staging production; do
    tvcurl "$lab" 1 "$1"; tvcurl "$lab" 2 "$1"; tvcurl "$lab" 3 "$1"
    tvcli "$lab" "$2"
  done
  tvcurl anonymous 1 token-rejected; tvcurl anonymous 2 token-rejected
  tvcurl anonymous 3 token-rejected; tvcli anonymous token-rejected
}

tvall token-rejected token-rejected
tvsay "class: refused on both clients is the credential class" \
  "Class, confirmed across both clients"
tvnot "class: does not blame the sampler" "The sampler, not the token"

tvall token-rejected ok
tvsay "sampler: refused on curl and ok on cli retires the class claim" \
  "The sampler, not the token"
tvnot "sampler: does not confirm the class" "Class, confirmed across both clients"

tvall token-rejected ok
tvcli anonymous ok
tvsay "control: a credential-less cli row that resolves the field breaks the run" \
  "CONTROL BROKEN"

tvall token-rejected ok
rm -f "$tvd/cli-staging.txt"
tvsay "coverage: a credential with no cli cell is not a comparison" \
  "The comparison is not available"
tvnot "coverage: the clean class sentence stays unreachable on a missing cell" \
  "Class, confirmed across both clients"
tvnot "coverage: the sampler sentence stays unreachable too" \
  "The sampler, not the token"

tvall token-rejected body-undecodable
tvsay "taxonomy: an unparseable cli body is a new observation, not a verdict" \
  "outside the taxonomy"
# The red control for that branch. F2's own sentence is `body-undecodable`
# (2026-11-22, job 137230172408), and the sampler used to reason "no `Not
# Authorized` text, so not an auth failure" — a rule that let a table of decode
# faults resolve to CLASS would hide the fault inside the credential probe.
tvnot "class over cli silence: unparseable bodies never read as the class" \
  "Class, confirmed across both clients"
# And not as a per-credential story either: with the cli side unparseable the
# honest sentence is "no answer", not "rotate these three secrets".
tvnot "class over cli silence: unparseable bodies are not a scope story either" \
  "Per-credential, not per-class"

tvall ok ok
tvsay "agreement: both clients authenticating contradicts 12:07Z" \
  "Both transports authenticate"

tvall token-rejected token-rejected
tvcli development ok
tvsay "per credential: one token differing is not a class statement" \
  "Per-credential, not per-class"

tvreset
checks=$((checks + 1))
if grep -qF -- "No cells at all" <<<"$(tvout)"; then
  echo "ok   empty: no transcripts says nothing was measured"
else
  echo "FAIL empty: an empty collection rendered as a result"; fails=$((fails + 1))
fi

# Three curl attempts are ONE credential. Rendered as three rows the table looks
# like three more credentials and every branch below it reads `missing` — the
# exact failure the class verdict had before its grouping was fixed.
tvall token-rejected ok
checks=$((checks + 1))
n_rows=$(tvout | grep -c '^| development |')
if [[ "$n_rows" == "1" ]]; then
  echo "ok   collapse: three curl attempts render as one credential row"
else
  echo "FAIL collapse: development rendered $n_rows rows"; fails=$((fails + 1))
fi
checks=$((checks + 1))
if tvout | grep -qF -- "3/3 token-rejected"; then
  echo "ok   collapse: the curl row shows its agreement rate, not a bare verdict"
else
  echo "FAIL collapse: no agreement rate in the curl column"; fails=$((fails + 1))
fi

# Safety: nothing credential-shaped may reach $GITHUB_STEP_SUMMARY, and the cli
# side is exactly where a CLI sentence could carry one.
tvreset
tvcurl staging 1 'ra_FAKEfakefake'
tvcli staging 'rlwy_proj_FAKEfakefake'
checks=$((checks + 1))
if tvout > "$tvd/out.md" && ! grep -qE -- 'ra_FAKEfakefake|rlwy_proj_FAKEfakefake' "$tvd/out.md"; then
  echo "ok   safety: no credential-shaped text reaches the summary"
else
  echo "FAIL safety: a credential-shaped value was rendered verbatim"; fails=$((fails + 1))
fi

# Arg shape: quoted globs and the already-expanded file list must agree, or the
# first runner that forgets to quote prints a verdict this suite never tested.
tvall token-rejected ok
checks=$((checks + 1))
tq=$(tvout)
te=$(python3 "$tv" --curl-glob "$tvd"/class-*.txt --cli-glob "$tvd"/cli-*.txt)
if [[ "$tq" == "$te" ]]; then
  echo "ok   arg shape: quoted globs and expanded paths answer identically"
else
  echo "FAIL arg shape: the two spellings disagree"; fails=$((fails + 1))
fi

want "workflow: the transport verdict calls the rules file" 'python3 scripts/ci/f2-transport-verdict.py' "$tc" present
want "workflow: the transport verdict quotes the cli glob" '--cli-glob "/tmp/cli-\*\.txt"' "$tc" present
want "workflow: the cli cells override the transport per step" 'PROBE_TRANSPORT: cli' "$tc" present
want "workflow: the cli cells tee beside the curl cells" 'tee "/tmp/cli-\$\{CLASS_LABEL\}.txt"' "$tc" present
checks=$((checks + 1))
n_cli=$(grep -cE -- '^\s+- name: .cli transport' "$tc")
if [[ "$n_cli" == "4" ]]; then
  echo "ok   workflow: four cli-transport steps — control plus three credentials"
else
  echo "FAIL workflow: expected 4 cli-transport steps, found $n_cli"; fails=$((fails + 1))
fi

# The status cell used to print the version the workflow ASKED FOR and nothing
# else, while its own comment promised a measurement. Drive the probe against a
# stub whose version disagrees with the pin and require BOTH spellings in the
# cell, so a silently wrong binary is visible instead of asserted.
stub=$(mktemp -d)
cat > "$stub/timeout" <<'STUB'
#!/bin/sh
# macOS ships no coreutils timeout; the probe calls `timeout <secs> cmd…`.
shift
exec "$@"
STUB
cat > "$stub/railway" <<'STUB'
#!/bin/sh
if [ "$1" = "--version" ]; then echo "railway 9.9.9"; exit 0; fi
if [ "$1" = "status" ]; then
  printf '{"environments":['
  i=0
  while [ "$i" -lt 120 ]; do printf '"a-b-c-d-e-f-g-h",' ; i=$((i + 1)); done
  printf '"x"]}'
  exit 0
fi
exit 1
STUB
chmod +x "$stub/timeout" "$stub/railway"
runstub() {
  PATH="$stub:$PATH" PROBE_STATUS_CLI="$stub/railway" CLASS_LABEL=stubbed \
    PROBE_RAILWAY_VERSION=5.40.1 bash scripts/ci/f2-status-probe.sh 2>&1
}

checks=$((checks + 1))
scell=$(runstub)
if grep -qF -- "cli=9.9.9 pin=5.40.1" <<<"$scell"; then
  echo "ok   status cell reports the binary that ran AS WELL AS the pin"
else
  echo "FAIL status cell does not distinguish measured from requested:"
  sed 's/^/         /' <<<"$scell" | head -6; fails=$((fails + 1))
fi
checks=$((checks + 1))
if grep -qF -- "not the pinned 5.40.1" <<<"$scell"; then
  echo "ok   status cell caveats when the binary disagrees with the pin"
else
  echo "FAIL status cell silently accepted the wrong binary"; fails=$((fails + 1))
fi

# And the other direction: agreement must add no caveat, or the caveat becomes
# noise a reader learns to skip.
cat > "$stub/railway" <<'STUB'
#!/bin/sh
if [ "$1" = "--version" ]; then echo "railway 5.40.1"; exit 0; fi
if [ "$1" = "status" ]; then
  printf '{"environments":['
  i=0
  while [ "$i" -lt 120 ]; do printf '"a-b-c-d-e-f-g-h",' ; i=$((i + 1)); done
  printf '"x"]}'
  exit 0
fi
exit 1
STUB
checks=$((checks + 1))
scell2=$(runstub)
if grep -qF -- "verdict=decoded" <<<"$scell2" && ! grep -qF -- "not the pinned" <<<"$scell2"; then
  echo "ok   a matching pin decodes with no caveat"
else
  echo "FAIL matching pin still caveats:"
  sed 's/^/         /' <<<"$scell2" | head -6; fails=$((fails + 1))
fi

# Two caveats in one cell must not delete each other: the cell parser keeps the
# LAST value of a repeated key, which is why the probe accumulates into one line.
# Here the wrong binary AND a too-small body are both true of one run.
cat > "$stub/railway" <<'STUB'
#!/bin/sh
if [ "$1" = "--version" ]; then echo "railway 9.9.9"; exit 0; fi
if [ "$1" = "status" ]; then printf '{"environments":[]}'; exit 0; fi
exit 1
STUB
checks=$((checks + 1))
scell3=$(runstub)
n_cav=$(grep -c "^STATUS_CELL caveat=" <<<"$scell3")
if [[ "$n_cav" == "1" ]] && grep -qF -- "not the pinned 5.40.1" <<<"$scell3" \
   && grep -qF -- "decoded-but-small" <<<"$scell3"; then
  echo "ok   caveats accumulate into one line instead of overwriting each other"
else
  echo "FAIL caveat collision: $n_cav caveat line(s)"; sed 's/^/         /' <<<"$scell3" | head -6; fails=$((fails + 1))
fi

# The cli transport branch has to survive the CLI's own commentary. Measured on
# 5.40.1: a non-200 response prints the JSON body AND a sentence on the next
# line, and a body with a sentence glued to it does not parse — a refused
# credential would have been reported as a transport fault.
tp=scripts/ci/f2-token-probe.sh
want "cli transport lets the CLI print an error body without failing" '--allow-errors' "$tp" present
want "cli transport keeps only the compact body line" "sed -n '1p' \\| mask" "$tp" present
checks=$((checks + 1))
if grep -qE -- 'STATUS_CELL cli=\$\{VERSION\}' scripts/ci/f2-status-probe.sh; then
  echo "FAIL the status cell prints the pin as if it were the measurement again"; fails=$((fails + 1))
else
  echo "ok   the status cell no longer prints the pin as the measurement"
fi

rm -rf "$stub" "$tvd"

reset_class
rm -rf "$classd"

echo "-- $((checks - fails))/$checks checks pass"
if [[ "$fails" -gt 0 ]]; then echo "F2 PROBE TESTS FAILED: $fails"; exit 1; fi
echo ok
