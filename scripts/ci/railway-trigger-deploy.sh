#!/usr/bin/env bash
# Deploy one Railway service through the GIT-CONNECTED trigger lane instead of an
# archive upload, then wait for THAT commit's deployment row and, when a public
# build endpoint exists, verify the instance actually serves it.
#
# WHY THIS EXISTS (2026-11-18).
# `railway up` to the staging environment has refused in CI for twelve recorded
# episodes with a sub-second `Failed to fetch: error decoding response body` and
# zero deployment rows — see docs/devops/railway-upload-fault-report.md (F2). Size,
# `--verbose`, the retry budget and a replaced credential were each tested and each
# eliminated; the same runner uploaded to development in the same minutes, and in
# one window (21:54Z) it uploaded to staging successfully too — so the fault is
# intermittent, not a permanent property of the target. What is not intermittent is
# the other transport: `serviceInstanceDeploy`, the mutation behind the dashboard's
# Deploy button, has landed every recent staging build, and run 44406178859 showed
# it returning `true` from a GitHub runner authenticated with
# `RAILWAY_TOKEN_STAGING` (row `9f0d3f7c`, `meta.commitHash` = that run's sha,
# status SUCCESS). This script is that transport, shaped for CI.
#
# What changes against railway-deploy.sh, and what must not "get fixed" back:
#   * No archive, therefore no UPLOAD_PATH / ROOT_FLAG / BUILD_DIR. Those exist to
#     match an instance's `rootDirectory` inside an archive we ship; this lane ships
#     none. It is only correct where a repo-root build produces the right app —
#     staging. development and production have `rootDirectory: None` on the
#     frontends, so a trigger build there would run the ROOT Dockerfile, which is
#     the Go backend. They keep the upload lane.
#   * The commit is PINNED with `commitSha`, never `latestCommit: true`. A merge
#     train makes `latestCommit` deploy a sha the release gate never approved, and
#     the gate's whole job is to bless one specific commit.
#   * The wait selects the new row by identity, in two steps: an id that was not
#     listed before the mutation, and `meta.commitHash` equal to $SHA. It does NOT
#     use `meta.cliMessage`, which is written by `railway up --message` and is null
#     on every git-connected row — the upload script's selector would time out here
#     even on a successful deploy. It also does NOT filter on a timestamp:
#     `railway deployment list --json` emits only `createdAt id meta status`
#     (measured 2026-11-18), and `gmtCreate`, the field the REST/GraphQL layer uses,
#     is absent, so the first version of this filter silently matched nothing for
#     nine minutes while the deployment it was waiting on had already succeeded.
#   * Verification is stronger, not weaker: a git build sets RAILWAY_GIT_COMMIT_SHA,
#     so backend's GET /api/v1/public/build answers the deployed sha with
#     `source: "env"`. When VERIFY_URL is set, `SUCCESS` alone is not enough.
#
# Required env:
#   SERVICE          Railway service name (backend | frontend-web | frontend-admin)
#   SERVICE_ID       that service's Railway id (the mutation needs the id, not the name)
#   ENVIRONMENT_ID   the target environment id (the staging token cannot resolve
#                    environment NAMES — `--environment development` with it dies
#                    with `Environment "development" not found`)
#   SHA              full commit sha to deploy; pinned into the mutation and matched
#                    against the row, so a wrong id or a stale row cannot pass silently
#   RAILWAY_TOKEN    per-environment token
#   RAILWAY_PROJECT  project id
# Optional env:
#   RAILWAY_ENV      environment name for the read/log calls (default staging)
#   VERIFY_URL       public build endpoint (backend). Compared against $SHA before exit 0.
#   ATTEMPTS         poll attempts, 15 s apart (default 40 = 10 minutes)
#   MUTATE_ATTEMPTS / MUTATE_BASE_DELAY_S  passed to scripts/ci/with-retry.sh for the
#                    initiate call (defaults: 4 attempts, 15 s base)
#   SKIP_VERIFY      'true' = do not fail on the VERIFY_URL comparison (still printed)

set -euo pipefail

: "${SERVICE:?required: SERVICE}"
: "${SERVICE_ID:?required: SERVICE_ID}"
: "${ENVIRONMENT_ID:?required: ENVIRONMENT_ID}"
: "${SHA:?required: SHA}"
: "${RAILWAY_TOKEN:?required: RAILWAY_TOKEN}"
: "${RAILWAY_PROJECT:?required: RAILWAY_PROJECT}"
RAILWAY_ENV="${RAILWAY_ENV:-staging}"
VERIFY_URL="${VERIFY_URL:-}"
ATTEMPTS="${ATTEMPTS:-40}"
SKIP_VERIFY="${SKIP_VERIFY:-false}"

[ -n "$RAILWAY_TOKEN" ] || { echo "::error::RAILWAY_TOKEN is empty for $SERVICE trigger deploy"; exit 1; }

redact() {
  # Application logs can contain anything, and a raw dump into a job log is how a
  # secret escapes. Both shapes below are real on this repo (a Supabase/JWT bearer
  # and a Paystack key pair).
  sed -E 's#eyJ[A-Za-z0-9._-]{20,}#<jwt-redacted>#g; s#(sk_|pk_)[A-Za-z0-9_-]{10,}#<key-redacted>#g'
}

list_rows() {
  railway deployment list --service "$SERVICE" --environment "$RAILWAY_ENV" \
    --project "$RAILWAY_PROJECT" --limit 20 --json 2>/dev/null || true
}

fresh_row() {
  # The newest row whose id did not exist before the mutation. Prefer the one that
  # carries our commit; if a new row exists without it, still report it — with
  # commit_match false — so an unexpected row is visible instead of invisible.
  list_rows | BEFORE_IDS="$BEFORE_IDS" SHA="$SHA" python3 -c '
import os, sys, json
before = set(os.environ["BEFORE_IDS"].split())
sha = os.environ["SHA"].lower()
try:
    rows = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(0)
rows = rows if isinstance(rows, list) else []
fresh = [r for r in rows if str(r.get("id")) not in before]
def commit(r):
    return str((r.get("meta") or {}).get("commitHash") or "").strip().lower()
ours = [r for r in fresh if commit(r) and sha.startswith(commit(r))]
pick = (ours or fresh)[:1]
for r in pick:
    m = r.get("meta") or {}
    print(json.dumps({"id": r.get("id"), "status": r.get("status"),
                      "created": r.get("createdAt"), "commit": m.get("commitHash"),
                      "branch": m.get("branch"), "message": m.get("cliMessage"),
                      "commit_match": bool(ours)}))
'
}

echo "=== deploying $SERVICE through the trigger lane ($SHA) ==="

# Snapshot BEFORE the mutation. Doing this after is what makes an older row for the
# same sha look like ours — which happens the moment a leg re-runs a commit that was
# already deployed once.
BEFORE_IDS="$(list_rows | jq -r '.[].id' | paste -sd' ' -)"
echo "pre-existing staging rows for $SERVICE: $(printf '%s' "$BEFORE_IDS" | wc -w)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RETRY_ATTEMPTS="${MUTATE_ATTEMPTS:-4}"
export RETRY_BASE_DELAY_S="${MUTATE_BASE_DELAY_S:-15}"
# `railway api` prints the GraphQL envelope, so success reads
# `{"data": {"serviceInstanceDeploy": true}}`. The exit code alone is not the
# verdict: a `false` return means the instance declined to start, and waiting for a
# row that will never appear is exactly the ten-minute silence this lane replaces.
mutate_out="$(bash "$SCRIPT_DIR/with-retry.sh" railway api \
  'mutation($s: String!, $e: String!, $sha: String!){ serviceInstanceDeploy(serviceId: $s, environmentId: $e, commitSha: $sha) }' \
  --var "s=$SERVICE_ID" --var "e=$ENVIRONMENT_ID" --var "sha=$SHA" 2>&1)" || {
  echo "::error::$SERVICE trigger initiate refused"
  printf '%s\n' "$mutate_out" | redact
  exit 1
}
echo "initiate answered: $(printf '%s' "$mutate_out" | tr '\n' ' ' | cut -c1-200)"
case "$mutate_out" in
  *'"data"'*true*) : ;;
  *) echo "::error::$SERVICE serviceInstanceDeploy did not return data=true — no deployment was started"; printf '%s\n' "$mutate_out" | redact; exit 1 ;;
esac

for attempt in $(seq 1 "$ATTEMPTS"); do
  row="$(fresh_row)"
  status="$(printf '%s' "$row" | jq -r '.status // empty')"
  case "$status" in
    SUCCESS)
      if [ "$(printf '%s' "$row" | jq -r '.commit_match')" != true ]; then
        echo "::error::a new $SERVICE row appeared but does not carry $SHA — refusing to call it ours"
        printf '%s\n' "$row" | jq .
        exit 1
      fi
      # These three are read into variables BEFORE the echo. Nesting `$(printf … |
      # jq -r '…')` inside a double-quoted string that itself contains a nested
      # `$(` does not tokenize the way it reads: bash handed jq `.branch // "?"),
      # created` as one program, which dies with `unexpected INVALID_CHARACTER` and
      # the line printed an empty branch. Measured in this script's own test.
      row_id="$(printf '%s' "$row" | jq -r '.id // "?"' | cut -c1-8)"
      row_branch="$(printf '%s' "$row" | jq -r '.branch // "?"')"
      row_created="$(printf '%s' "$row" | jq -r '.created // "?"')"
      echo "=== $SERVICE deployed $SHA (row $row_id, branch $row_branch, created $row_created) ==="
      if [ -n "$VERIFY_URL" ]; then
        echo "--- what the instance says it serves ---"
        served="$(curl -s --http1.1 -m 25 "$VERIFY_URL" || true)"
        printf '%s\n' "$served"
        got="$(printf '%s' "$served" | jq -r '.commit // empty' 2>/dev/null || true)"
        if [ "$got" = "$SHA" ]; then
          echo "=== verified: $VERIFY_URL serves $SHA ==="
        elif [ "$SKIP_VERIFY" = true ]; then
          echo "::warning::served commit ${got:-none} != $SHA (SKIP_VERIFY=true, not failing)"
        else
          echo "::error::deployment row says SUCCESS but $VERIFY_URL serves ${got:-no commit} — expected $SHA"
          exit 1
        fi
      fi
      exit 0
      ;;
    FAILED|CRASHED|REMOVED)
      echo "::error::$SERVICE deployment ended with $status"
      printf '  row: %s\n' "$row"
      # Same reasoning as railway-deploy.sh: `railway logs` without --latest targets
      # the CURRENT deployment, which is the OLD still-serving one when this row
      # failed. DEPLOYMENT_ID is a positional argument, not a value for the boolean
      # --deployment flag, so `--latest` is the robust form. DO NOT "fix" this back.
      # stderr is kept (redacted) because a CLI usage error otherwise looks exactly
      # like "zero log lines exist".
      railway logs --deployment --latest --service "$SERVICE" \
        --environment "$RAILWAY_ENV" --project "$RAILWAY_PROJECT" \
        --lines 300 > dep.log 2>&1 || true
      echo "  fetched $(wc -l < dep.log) log lines for this deployment"
      SIG='panic:|fatal error|nil pointer|runtime error|goroutine [0-9]+ \[|listen tcp|bind: address already in use|Validate\(\)|refusing to start|exit status|SIGSEGV|SIGABRT|error during build|exited with code'
      if grep -qaiE "$SIG" dep.log; then
        echo "  --- crash signatures (redacted) ---"
        grep -aiE "$SIG" dep.log | tail -60 | redact
      else
        echo "  no crash signature matched — last lines emitted before the deployment ended:"
        tail -40 dep.log | redact
      fi
      exit 1
      ;;
    *)
      echo "  waiting for $SERVICE (attempt $attempt/$ATTEMPTS; status: ${status:-no-new-row-yet})"
      sleep 15
      ;;
  esac
done

echo "::error::timed out after $((ATTEMPTS * 15))s waiting for a new $SERVICE row for $SHA"
echo "--- the newest staging rows for $SERVICE, for context ---"
list_rows | jq -r '.[] | "  \(.id[0:8]) \(.status) created=\(.createdAt // "?") commit=\((.meta.commitHash // "-")[0:12]) msg=\(.meta.cliMessage // "-")"' | head -12 || true
exit 1
