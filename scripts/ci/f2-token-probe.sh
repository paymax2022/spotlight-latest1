#!/usr/bin/env bash
# scripts/ci/f2-token-probe.sh — can the staging PROJECT TOKEN deploy?
#
# WHY THIS EXISTS
# F2 is the release wall: every `deploy Staging (…)` leg of every train since
# 2026-11-16 dies on `error decoding response body`, so `smoke Staging` and the
# whole production chain skip and main never reaches staging or prod on its own.
# The lane that DOES work is the GraphQL mutation `serviceInstanceDeploy(…,
# latestCommit:true)`, measured repeatedly from the owner's user session — no
# upload, SUCCESS in ~3 min. The one cell nobody can fill in from a laptop is
# whether that same mutation works with the token CI holds, a project token:
# `projectTokenCreate` is refused for the owner session, so the token that
# matters exists only inside a runner. This script is that cell.
#
# IT ANSWERS IN ONE LINE  (PROBE_VERDICT=…)
#   project-token-can-deploy           → swap the staging legs off `railway up`
#                                         onto this mutation; the wall moves.
#   token-scope-blocks-mutation        → the token is the variable; ask Railway
#                                         for deploy scope, the upload stays broken.
#   mutation-is-noop-for-project-token → `true` that creates no row, the shape
#                                         already measured on production's
#                                         git-less frontend-admin.
#   f2-reproduces-on-the-mutation-path → F2 lives in the transport/edge, not in
#                                         the upload endpoint, and no CI-side
#                                         script change will fix it.
#
# SAFETY
#   * Default mode is read-only: two queries per service, no state change.
#     `mode=mutate` has to be chosen on the dispatch form and only ever
#     addresses STAGING — the environment id is hardcoded below, there is no
#     production id in this file.
#   * The token is never printed: it travels in a header and every body passes
#     through mask() first.
#   * It never runs `railway up`. An upload probe cannot be made safe: an
#     upload that SUCCEEDED from a throwaway directory would deploy that
#     directory. The mutation needs no archive, which is the whole point.
#
# TRANSPORTS
#   curl (CI):  raw HTTPS, so edge status codes are visible. This matters:
#               measured 2026-11-22, a REJECTED token arrives as **HTTP 200**
#               with errors[].message "Not Authorized" — a verdict that keys on
#               the status code reads a token failure as success.
#   cli (local): pipes the identical documents through `railway api`, which uses
#               the owner's session, so the documents can be proven on a laptop
#               without ever touching the project token. The CLI hides edge
#               statuses; a cli run reports http=cli-transport.
set -uo pipefail

ENDPOINT="${RAILWAY_API_URL:-https://backboard.railway.com/graphql/v2}"
TRANSPORT="${PROBE_TRANSPORT:-curl}"
MODE="${PROBE_MODE:-read-only}"
SERVICE_NAME="${PROBE_SERVICE_NAME:-backend}"
PROJECT_ID="${PROBE_PROJECT_ID:-e7dca861-3667-4d9a-8090-6d2f4d179ec2}"
# Staging only. Deliberately not read from the workflow: a probe that could be
# pointed at production is a probe that redeploys production.
STAGING_ENV_ID="${PROBE_ENVIRONMENT_ID:-6b5f27a3-a290-4574-a977-363eb21d43ad}"
POLL_BUDGET_S="${PROBE_POLL_BUDGET_S:-300}"
POLL_INTERVAL_S="${PROBE_POLL_INTERVAL_S:-15}"
VERDICT_FILE="${PROBE_VERDICT_FILE:-/tmp/f2-probe-verdict}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# staging Service.id values, re-read from the API on 2026-11-22. Ids are not
# secrets; they are the thing that silently breaks when a service is recreated,
# so they are named here rather than guessed at a call site.
service_id_for() {
  case "$1" in
    backend) echo "70de07d8-c058-4221-b645-61c4f1ac7aa5" ;;
    frontend-web) echo "dda6372c-0bb7-4014-a2b1-aa646c11a281" ;;
    frontend-admin) echo "c4f1086e-0a2d-4367-b503-209c14a2ce6f" ;;
    *) echo "" ;;
  esac
}

DOC_AUTH='query($p:String!){ project(id:$p){ id name } }'
DOC_ROW='query($s:String!,$e:String!){ serviceInstance(serviceId:$s, environmentId:$e){ latestDeployment{ id createdAt status meta } } }'
DOC_DEPLOY='mutation($s:String!,$e:String!,$latest:Boolean){ serviceInstanceDeploy(serviceId:$s, environmentId:$e, latestCommit:$latest) }'

if [[ "${1:-}" == "--check-documents" ]]; then
  # Read by the offline test, and by anyone re-checking the arg shapes against
  # the schema: __type(name:"Query") gives project(id:String!) and
  # serviceInstance(environmentId:String!, serviceId:String!);
  # __type(name:"Mutation") gives serviceInstanceDeploy(commitSha:String,
  # environmentId:String, latestCommit:Boolean, serviceId:String).
  printf 'DOC\t%s\n' "$DOC_AUTH" "$DOC_ROW" "$DOC_DEPLOY"
  exit 0
fi

case "$MODE" in read-only | mutate) : ;; *)
  echo "::error::unknown PROBE_MODE '$MODE' (read-only|mutate)"; exit 2 ;;
esac

services=()
if [[ "$SERVICE_NAME" == "all" ]]; then
  services=(backend frontend-web frontend-admin)
else
  services=("$SERVICE_NAME")
fi
for s in "${services[@]}"; do
  [[ -n "$(service_id_for "$s")" ]] || {
    echo "::error::unknown PROBE_SERVICE_NAME '$s' (backend|frontend-web|frontend-admin|all)"; exit 2; }
done

mask() {
  # Fixed-string replacement, not a sed pattern: a token is arbitrary text and
  # must never be interpolated into a regex.
  RAILWAY_TOKEN_MASK="${RAILWAY_TOKEN:-}" python3 -c '
import os, sys
tok = os.environ.get("RAILWAY_TOKEN_MASK") or ""
body = sys.stdin.read()
sys.stdout.write(body.replace(tok, "***REDACTED***") if tok else body)'
}

# gql <document> <variables-json>  → body on stdout, HTTP code in $HTTP_FILE.
# Variables go as JSON; nothing is interpolated into a document. Each cell sends
# ONLY its own variables — an undeclared extra is a validation error.
#
# The status goes through a FILE, not a variable: every call site is
# `body=$(gql …)`, and a command substitution runs in a subshell, so an
# assignment to HTTP_CODE there is invisible to the parent. Measured on the
# first local run (2026-11-22): with a variable the auth cell printed
# "auth=transport-error-no-response (http=)" while the very same response body
# parsed cleanly — i.e. a working token would have been reported as a broken
# transport and the workflow would have exited 1 on a healthy staging project.
HTTP_FILE="${PROBE_HTTP_FILE:-/tmp/f2-probe-http}"
gql() {
  local doc="$1" vars="$2"
  if [[ "$TRANSPORT" == "cli" ]]; then
    printf 'cli-transport' > "$HTTP_FILE"
    local args=(api "$doc" --compact --allow-errors)
    local pair
    for pair in $(python3 -c '
import json,sys
for k,v in json.loads(sys.argv[1]).items(): print(f"{k}={v}")' "$vars"); do
      args+=(--var "$pair")
    done
    # `sed -n '1p'` is measurement, not tidiness. Measured on 2026-11-23 against
    # @railway/cli@5.40.1: for any non-200 HTTP status the CLI prints the JSON
    # body AND a human sentence ("Railway API request failed with HTTP 400 Bad
    # Request") on the next line, and a two-line "body" is not parseable JSON —
    # f2-probe-verdict.py would have called a refused credential a transport
    # fault. --compact makes the document one line, so line 1 is the answer and
    # everything after it is commentary. An auth refusal that arrives as a plain
    # 200 (the shape that matters here) prints only the body either way.
    "${RAILWAY_CLI:-railway}" "${args[@]}" 2>&1 | sed -n '1p' | mask
  else
    local payload
    payload=$(python3 -c '
import json,sys
print(json.dumps({"query": sys.argv[1], "variables": json.loads(sys.argv[2])}))' "$doc" "$vars")
    curl -sS -o /tmp/f2-probe-body.json -w '%{http_code}' -m 45 \
      -X POST "$ENDPOINT" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${RAILWAY_TOKEN:-}" \
      --data "$payload" > "$HTTP_FILE" 2>/dev/null
    # A refused connection leaves curl printing nothing; -w still owes a code.
    [[ -s "$HTTP_FILE" ]] || printf '000' > "$HTTP_FILE"
    mask < /tmp/f2-probe-body.json
  fi
}

http_code() { cat "$HTTP_FILE" 2>/dev/null || echo ""; }

row_field() { # <body> <field>
  python3 -c '
import json,sys
try:
    d = json.loads(sys.argv[1])["data"]["serviceInstance"]["latestDeployment"] or {}
except Exception:
    d = {}
print(d.get(sys.argv[2], ""))' "$1" "$2"
}

verdicts=()

probe_service() {
  local name="$1" service_id
  service_id="$(service_id_for "$name")"
  echo "::group::F2 token probe — ${name} / staging / mode=${MODE} / transport=${TRANSPORT}"
  echo "project=${PROJECT_ID}  stagingEnvironment=${STAGING_ENV_ID}  service=${service_id}"
  echo "endpoint=${ENDPOINT}"

  echo "--- cell 1: auth (project read — does this token authenticate?)"
  local http; local body; body=$(gql "$DOC_AUTH" "{\"p\":\"$PROJECT_ID\"}"); http=$(http_code)
  echo "${body:0:400}"; echo
  local auth; auth=$(python3 "$HERE/f2-probe-verdict.py" read "$body" "$http")
  echo "PROBE_CELL auth=$auth (http=$http)"

  echo "--- cell 2: baseline (the deployment row to diff against)"
  body=$(gql "$DOC_ROW" "{\"s\":\"$service_id\",\"e\":\"$STAGING_ENV_ID\"}"); http=$(http_code)
  echo "${body:0:400}"; echo
  local baseline; baseline=$(python3 "$HERE/f2-probe-verdict.py" read "$body" "$http")
  local base_id; base_id=$(row_field "$body" id)
  echo "PROBE_CELL baseline=$baseline row=${base_id:0:8} status=$(row_field "$body" status)"

  local mut=not-run build=not-run rows='[]'
  if [[ "$MODE" == "mutate" ]]; then
    echo "--- cell 3: the missing cell — project token x serviceInstanceDeploy"
    body=$(gql "$DOC_DEPLOY" "{\"s\":\"$service_id\",\"e\":\"$STAGING_ENV_ID\",\"latest\":true}"); http=$(http_code)
    echo "${body:0:400}"; echo
    mut=$(python3 "$HERE/f2-probe-verdict.py" mutation "$body" "$http")
    echo "PROBE_CELL mutation=$mut (http=$http)"

    if [[ "$mut" == "accepted" ]]; then
      echo "--- cell 4: did a ROW appear? \`true\` alone is not proof"
      local waited=0 new_id new_st is_new read_st=ok
      if [[ -z "$base_id" ]]; then
        # Cell 2 was refused, so there is no baseline id to diff against and no
        # number of polls will produce one. Say the cell is blind instead of
        # letting an empty base make every row look new.
        read_st=skipped
        build=no-baseline-to-diff
      else
        while [[ "$waited" -lt "$POLL_BUDGET_S" ]]; do
          sleep "$POLL_INTERVAL_S"; waited=$((waited + POLL_INTERVAL_S))
          body=$(gql "$DOC_ROW" "{\"s\":\"$service_id\",\"e\":\"$STAGING_ENV_ID\"}")
          new_id=$(row_field "$body" id); new_st=$(row_field "$body" status)
          read_st=$(python3 "$HERE/f2-probe-verdict.py" read "$body" "$(http_code)")
          # "new" is only a fact when the readback actually named a row: an
          # empty new_id against a real base_id is a difference, and the code
          # before this guard read that as a new SUCCESS row — a refused
          # readback could therefore end the run with the green verdict.
          is_new=false
          [[ -n "$new_id" && "$new_id" != "$base_id" ]] && is_new=true
          rows="[{\"id\":\"${new_id:0:8}\",\"status\":\"$new_st\",\"isNew\":$is_new}]"
          echo "  [+${waited}s] row=${new_id:0:8} status=$new_st isNew=$is_new read=$read_st"
          [[ "$read_st" == "ok" ]] || break
          if $is_new && [[ "$new_st" == SUCCESS || "$new_st" == FAILED ]]; then break; fi
        done
        if [[ "$read_st" == "ok" ]]; then
          build=$(python3 "$HERE/f2-probe-verdict.py" readback "$rows")
        else
          build=readback-unreadable
        fi
      fi
      echo "PROBE_CELL readback=$build after ${waited}s (read=$read_st)"
    fi
  fi

  local v; v=$(python3 "$HERE/f2-probe-verdict.py" final "$auth" "$baseline" "$mut" "$build" "$MODE")
  echo "::endgroup::"
  echo "PROBE_VERDICT[$name]=$v"
  verdicts+=("$name=$v")

  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "| ${name} | \`$auth\` | \`$baseline\` \`${base_id:0:8}\` | \`$mut\` | \`$build\` | \`$v\` |"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  # A run whose token could not even authenticate is a failed probe, not a
  # verdict — cli transport is exempt because the owner session answers for it.
  [[ "$auth" == "ok" || "$TRANSPORT" == "cli" ]] || return 1
  return 0
}

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### F2 project-token probe — staging, mode=\`${MODE}\`"
    echo
    echo "| service | auth | baseline | mutation | readback | verdict |"
    echo "|---|---|---|---|---|---|"
  } >> "$GITHUB_STEP_SUMMARY"
fi

rc=0
for s in "${services[@]}"; do probe_service "$s" || rc=1; done

# The workflow's "Verdict" step reads this file; writing it keeps the summary
# truthful even when the last service returned non-zero.
printf '%s\n' "$(IFS=';'; echo "${verdicts[*]}")" > "$VERDICT_FILE" || true
exit "$rc"
