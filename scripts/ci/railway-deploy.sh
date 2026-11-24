#!/usr/bin/env bash
# Upload one service to one Railway environment, wait for the deployment to
# settle, and dump a REDACTED crash log when it does not.
#
# Extracted from ci.yml's three deploy jobs and development-deploy.yml — all four
# now deleted, text at 6199a6b57 — where it existed four times and three of the
# four were wrong. Two behaviours in here were
# each discovered the hard way; they are documented at the point of use so nobody
# "fixes" them back.
#
# Required env:
#   SERVICE          Railway service name (backend | frontend-web | frontend-admin)
#   RAILWAY_ENV      Railway environment (development | staging | production)
#   SHA              the commit being deployed; used as the deployment --message so
#                    the poll below can find THIS deployment among the last ten
#   RAILWAY_TOKEN    per-environment token
#   RAILWAY_PROJECT  e7dca861-3667-4d9a-8090-6d2f4d179ec2
# Optional env:
#   DEPLOY_METHOD    'upload' (default) | 'mutation'. See WHY MUTATION MODE
#                    EXISTS below. Everything else in this file is unchanged by
#                    it: same polling budget, same crash-log dump, same
#                    redaction, same exit codes.
#   SERVICE_ID       Railway Service.id — REQUIRED with DEPLOY_METHOD=mutation
#                    (the GraphQL mutation takes ids, not names, and nothing in
#                    the CLI resolves name -> id without a linked project)
#   RAILWAY_ENVIRONMENT_ID  same, for the environment
#   UPLOAD_PATH      positional path for `railway up` ('' = none)
#   ROOT_FLAG        '--path-as-root' or ''
#   BUILD_DIR        when set, $SHA is written to $BUILD_DIR/BUILD_COMMIT first
#   ARCHIVE_SUBDIR   optional committed directory to include under the archive root;
#                    historically what release.yml's STAGING frontend legs passed
#                    (they had a rootDirectory, so the archive had to keep that
#                    folder without shipping the whole monorepo). Since
#                    2026-11-23 no workflow passes it — staging deploys by
#                    mutation — but the code stays: an owner uploading to a
#                    rootDirectory-backed instance needs exactly this shape, and
#                    scripts/ci/test-railway-deploy-archive.sh is the only thing
#                    that still proves it. Do not delete it with the leg.
#   ATTEMPTS         poll attempts, 15s apart (default 40 = 10 minutes)
#   RAILWAY_HTTP_TIMEOUT  set by the caller; the CLI default of 90s truncates the
#                    110 MB frontend-web upload
#   RETRY_ATTEMPTS / RETRY_BASE_DELAY_S  passed to scripts/ci/with-retry.sh for
#                    the upload call (defaults here: 9 attempts, 60s base = 900 s
#                    of guaranteed backoff, sized to the measured fault window —
#                    see THE UPLOAD BUDGET below)
#
# WHY MUTATION MODE EXISTS (added 2026-11-23; the upload path above stays the
# default and stays what dev and production use).
# `railway up` against STAGING has not completed since 2026-11-16: every leg of
# every train dies on `Failed to fetch: error decoding response body`, 9-for-9,
# before the archive is packed. Two trains on 2026-11-23 close the "size" and
# "time window" readings:
#   45179479514  legs spanned 1,082-1,137 s
#   45194518587  main tip 09921c258, legs 14:59:02Z -> 15:16:34 / 15:16:48 /
#                15:17:03Z = 1,052-1,081 s
# and all six legs counted the same way: 9 `Failed to fetch`, 18 decode lines,
# 8 retry notices (9 tries), ZERO GnuTLS, ZERO `trial has expired`, ZERO
# `Indexing`, ZERO `Uploading`. The refusal precedes the archive, and it survives
# the full designed ladder — so nothing on this side of the request decides it.
#
# The lane that DOES work was measured the same afternoon by
# ci-railway-token-class.yml's write cell — run 45194092365, job 137759803757,
# 14:27:12Z, with the STAGING PROJECT TOKEN CI already holds and
# PROBE_TRANSPORT=cli (so the CLI's own bearer, not a raw curl):
#   PROBE_CELL mutation=accepted (http=cli-transport) sha=df6676406
#   [+15s] row=d1fb169d status=BUILDING isNew=true
#   [+30s] row=d1fb169d status=SUCCESS  isNew=true
#   PROBE_VERDICT[backend]=project-token-can-deploy
# i.e. `serviceInstanceDeploy(commitSha:)` produced a NEW SUCCESS row 30 s later
# and shipped zero bytes. The wall is therefore one GraphQL call CI is
# authorized to make. (That probe named df6676406 — the commit already serving
# staging — precisely so a measurement could not change what was live.)
#
# What mutation mode is NOT: it is not an F2 workaround that hides the fault.
# F2 stays open upstream (docs/devops/railway-upload-fault-report.md, Episodes
# 20 and 21), and the `railway up` path remains what release.yml's dev and
# production legs run, so an owner can still measure the fault. It is also not a
# redeploy of "whatever is newest": $SHA is required to be a full 40-hex commit,
# because a short sha on this API mints a FAILED row for a commit that does not
# exist (measured 2026-11-23: commitSha:"d563144" -> row a0f80410 FAILED,
# createdAt 12:56:43Z).
#
# And `true` alone is never read as success. That mutation answers `true` for a
# git-less service instance while creating no row at all (measured on production
# frontend-admin, reason=redeploy), so the row-watch below decides from a NEW
# Deployment row that names THIS sha and was created after this leg fired its
# mutation (STARTED_AT) — scripts/ci/staging-deploy-watch.py, whose verdict
# table is pinned by scripts/ci/test-staging-deploy-watch.sh. The cutoff is what
# stops a concurrent train's row for the same commit reading as our deploy;
# release.yml has no workflow-level concurrency, so two ladders on one sha are
# possible and were seen.
#
# THE UPLOAD RULE (read before changing UPLOAD_PATH or ROOT_FLAG):
#   The shape follows the service instance's Railway `rootDirectory`, which is NOT
#   the same in every environment. Measured 2026-11-16 with `railway api`
#   serviceInstance(serviceId, environmentId){ rootDirectory }:
#       staging      frontend-web -> 'frontend-web'   frontend-admin -> 'frontend-admin'
#       development  frontend-web -> None             frontend-admin -> None
#       production   frontend-web -> None             frontend-admin -> None
#       backend      None in all three
#   Railway resolves that directory INSIDE the archive `railway up` ships, so:
#     rootDirectory SET  -> UPLOAD_PATH=''  ROOT_FLAG=''    (archive = repo root)
#     rootDirectory None -> UPLOAD_PATH=<folder>  ROOT_FLAG=--path-as-root
#                           (archive root must BE the app folder; same as backend,
#                           whose Dockerfile it has to find)
#   For a rootDirectory-backed frontend, ARCHIVE_SUBDIR=<folder> creates a
#   commit-derived archive containing only that folder, while retaining the
#   repo-root shape Railway expects. The resulting archive still contains
#   <folder>/..., so Railway can strip its configured rootDirectory.
#   Getting this backwards fails in two different, now-observed ways:
#     - repo root where the instance has no rootDirectory builds the MONOREPO. The
#       upload reports SUCCESS and the app then 404s everything: development's
#       smoke failed with "/admin/login answered 404" on 2026-11-16, and the same
#       commit re-uploaded with --path-as-root returned 200 on that same host.
#     - app folder where the instance HAS a rootDirectory dies client-side during
#       indexing with "prefix not found" (Railway looks for `frontend-*/` inside an
#       archive that already is that folder). `railway up .` dies the same way when
#       rootDirectory is set — a CLI bug with an explicit `.`.
#   release.yml's three matrices carry the per-environment values; this script only
#   receives them. The old ci.yml and development-deploy.yml jobs cited here are
#   deleted — read their text at 6199a6b57.

set -euo pipefail

: "${SERVICE:?required: SERVICE}"
: "${RAILWAY_ENV:?required: RAILWAY_ENV}"
: "${SHA:?required: SHA}"
: "${RAILWAY_TOKEN:?required: RAILWAY_TOKEN}"
: "${RAILWAY_PROJECT:?required: RAILWAY_PROJECT}"
UPLOAD_PATH="${UPLOAD_PATH:-}"
ROOT_FLAG="${ROOT_FLAG:-}"
BUILD_DIR="${BUILD_DIR:-}"
ARCHIVE_SUBDIR="${ARCHIVE_SUBDIR:-}"
ATTEMPTS="${ATTEMPTS:-40}"
DEPLOY_METHOD="${DEPLOY_METHOD:-upload}"
SERVICE_ID="${SERVICE_ID:-}"
RAILWAY_ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-}"

case "$DEPLOY_METHOD" in
  upload) : ;;
  mutation)
    # Refuse a misconfigured leg before it asks Railway for anything: an
    # id-less mutation cannot be aimed at this service, and a short sha is the
    # exact shape that mints a FAILED row for a commit that does not exist.
    [ -n "$SERVICE_ID" ] || { echo "::error::DEPLOY_METHOD=mutation needs SERVICE_ID for $SERVICE/$RAILWAY_ENV" >&2; exit 2; }
    [ -n "$RAILWAY_ENVIRONMENT_ID" ] || { echo "::error::DEPLOY_METHOD=mutation needs RAILWAY_ENVIRONMENT_ID for $SERVICE/$RAILWAY_ENV" >&2; exit 2; }
    printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' \
      || { echo "::error::DEPLOY_METHOD=mutation needs SHA to be a full 40-hex commit (got: $SHA)" >&2; exit 2; }
    ;;
  *) echo "::error::unknown DEPLOY_METHOD '$DEPLOY_METHOD' (upload|mutation)" >&2; exit 2 ;;
esac

# Never printed, never logged. Referenced only so a missing token fails here with
# a clear name rather than deep inside the CLI.
[ -n "$RAILWAY_TOKEN" ] || { echo "::error::RAILWAY_TOKEN is empty for $RAILWAY_ENV/$SERVICE"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_TMP=""
cleanup_archive() {
  if [ -n "$ARCHIVE_TMP" ]; then
    rm -rf "$ARCHIVE_TMP"
  fi
}
trap cleanup_archive EXIT

# Mutation mode ships no archive: the `ARCHIVE_TMP` trap stays registered either
# way (it no-ops on an empty value), but building one would be wasted work and a
# second thing to get wrong, so the whole branch is upload-only.
if [ "$DEPLOY_METHOD" = upload ] && [ -n "$ARCHIVE_SUBDIR" ]; then
  case "$ARCHIVE_SUBDIR" in
    /*|.|./*|../*|*/../*|*/./*)
      echo "::error::ARCHIVE_SUBDIR must be a relative top-level directory: $ARCHIVE_SUBDIR" >&2
      exit 1
      ;;
  esac
  if ! git ls-tree -d --name-only "$SHA" -- "$ARCHIVE_SUBDIR" \
      | grep -Fxq "$ARCHIVE_SUBDIR"; then
    echo "::error::ARCHIVE_SUBDIR is not a directory in $SHA: $ARCHIVE_SUBDIR" >&2
    exit 1
  fi
  ARCHIVE_TMP="$(mktemp -d)"
  git archive --format=tar "$SHA" -- "$ARCHIVE_SUBDIR" | tar -xf - -C "$ARCHIVE_TMP"
  if [ -n "$BUILD_DIR" ]; then
    mkdir -p "$ARCHIVE_TMP/$BUILD_DIR"
    printf '%s' "$SHA" > "$ARCHIVE_TMP/$BUILD_DIR/BUILD_COMMIT"
  fi
fi

redact() {
  # Application logs can contain anything, and a raw dump into a job log is how a
  # secret escapes. Both shapes below are real on this repo (a Supabase/JWT bearer
  # and a Paystack key pair).
  sed -E 's#eyJ[A-Za-z0-9._-]{20,}#<jwt-redacted>#g; s#(sk_|pk_)[A-Za-z0-9_-]{10,}#<key-redacted>#g'
}

echo "=== deploying $SERVICE to $RAILWAY_ENV ($SHA) ==="

# Railway builds backend/Dockerfile itself from the uploaded directory, so a
# --build-arg cannot reach it. Writing the SHA into the build context is the way
# in: the Dockerfile reads BUILD_COMMIT and bakes it into the binary via -ldflags,
# and GET /api/v1/public/build then reports it. Without this a deployed server
# cannot say what it is running — /public/health returns the same bytes on every
# build, so it can never distinguish "deployed" from "did not deploy". That is the
# signal railway-smoke.sh reads back.
# Deliberately NOT stamped in mutation mode. The build happens on Railway's side
# from the commit it was named, so a file written in this runner's worktree
# cannot reach it, and writing one anyway would look like a marker that proves
# nothing. The marker still does its job on a mutation leg: railway-smoke.sh
# reads GET /api/v1/public/build after the deploy, and staging proved the
# read-back names the commit the mutation was given (the three staging services
# were deployed by this mutation at 0329a903a on 2026-11-23 and the backend then
# answered 0329a903a5ffccc96e8b080f9467f62fe185e32b, build started 14:29:41Z,
# with /readyz ready) — so a leg that built the wrong tree still goes red at
# smoke rather than here.
if [ -n "$BUILD_DIR" ]; then
  if [ "$DEPLOY_METHOD" = mutation ]; then
    echo "BUILD_COMMIT stamp skipped (mutation mode: the build is Railway's, not the runner's)"
  else
    printf '%s' "$SHA" > "$BUILD_DIR/BUILD_COMMIT"
    echo "stamped $BUILD_DIR/BUILD_COMMIT"
  fi
fi

# The upload request itself is retried; the poll loop below is not the same thing.
#
# Measured 2026-11-16, run 43904662033: `railway up backend --path-as-root
# --environment staging` died 400 ms in with
#     Failed to fetch: error decoding response body
#       0: error decoding response body
#       1: expected value at line 1 column 1
# — Railway's upload-initiate request answering with a non-JSON body. Twenty-one
# seconds earlier the same job, same token, same pinned CLI, had completed a
# staging upload in 15738 ms; run 43905428515 then replayed that exact failing
# command and it exited 0 in 3611 ms on 5.40.1 and 3448 ms on 5.74.1. Nothing on
# this side decides it, and no credential, flag, tree or service is at fault: the
# single-shot call is. One blip reddens every staging leg, and because smoke-
# staging is the gate on production it also blocks production — which is how a
# transient became a three-hour credential hunt.
#
# A retried attempt can create a second deployment for the same SHA. That is inert:
# both rows carry this commit as their message, the poll selects by meta.cliMessage,
# and the later deployment becomes the serving one either way.
#
# THE UPLOAD BUDGET (read before changing RETRY_*): it is set from the measured fault,
# not from feeling. Run 43909191817 put four attempts on a 15 s base against the live
# fault and lost 12-for-12: refusals ran continuously from 16:23:32 to at least 16:38:15Z, which is 883 s — longer than
# the entire 105-157 s of backoff that budget can produce. Retrying a fault for less
# time than the fault lasts is not tolerance, it is a slower halt. With-retry doubles
# and caps at 120 s, so 9 attempts from a 60 s base is 60 + 7*120 = 900 s of
# guaranteed sleep (1350 s with jitter), which clears the longest window observed and
# costs a genuinely broken leg up to ~15 minutes before it reports red. Nothing here
# claims that is sufficient: the fault is upstream and unbounded, and a longer window
# than this still halts.
#
# WHY --verbose IS ON THE UPLOAD (added 2026-11-18 after F2 episode 11).
# For two days this fault was unreportable because the CLI discards the response
# status and body: every log line we had said `error decoding response body /
# expected value at line 1 column 1`, and docs/devops/railway-upload-fault-report.md
# spent eleven episodes asking Railway for the status code. `railway up --verbose`
# prints the request URL with the environment and service IDs, the `bytes:` of the
# archive it is shipping, and — when the origin answer is not JSON — the HTTP
# status itself (`Failed to upload code with status code 524`). That single flag
# is what turned "uploads sometimes fail" into a URL, a size boundary (7,511,269 B
# accepted / 133,527,512 B refused, seven for seven) and two deployment IDs whose
# `snapshotId` is null. Support verified on the pinned version:
# `railway 5.40.1` → `railway up --help` lists `--verbose Verbose output`.
# It changes no behaviour: the poll below still selects by `meta.cliMessage`, and
# nothing here decides anything from the upload's wording — with-retry.sh may only
# match it against RETRY_NON_RETRYABLE to skip a doomed attempt, never to pick what
# gets deployed.
#
# $UPLOAD_PATH and $ROOT_FLAG are UNQUOTED ON PURPOSE: an empty value must vanish
# from the argument list, not arrive as an empty-string argument (which the CLI
# reads as a path of ""). See THE UPLOAD RULE above.
export RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-9}"
export RETRY_BASE_DELAY_S="${RETRY_BASE_DELAY_S:-60}"
# THE BUDGET RIDES OUT A WINDOW; IT MUST NOT ARGUE WITH AN ACCOUNT STATE.
# On 2026-11-19 the Railway trial lapsed and the three DEV legs of each of two release
# runs spent nine attempts each (~15 min of guaranteed sleep a leg) against
# `Your trial has expired. Please select a plan to continue using Railway.` — a refusal
# whose half-life is "until a human adds a plan", i.e. never. Worse, that message was
# invisible in the triaged logs and only the raw dev log carried it, so two runs were
# written off as F2 before anyone read it.
# 883 s of sleep is the right answer to a transient refusal and a 2.5 h blindfold on
# this one, so stop the ladder the moment Railway says what only a person can fix.
# Deliberately narrow: the decode-error refusal this file was written for is NOT here
# and still burns the full ladder (pinned by test-railway-deploy-retry.sh case 2).
#
# WHERE THE SAVING ACTS, and where it does not — per-leg census of runs 44482224276
# and 44488725106, counted as decode-lines / trial-lines / retry-notices (8 notices =
# 9 tries), identical in both runs: DEV legs 0 / 9 / 8, STAGING legs 18 / 0 / 8. So
# staging never printed the trial sentence, not once, in either run: its upload-initiate
# request dies on the non-JSON body before Railway's entitlement check is reached, and
# the guard has nothing to match. Expect this fail-fast to spare the dev legs (and any
# leg that gets far enough to be told) only. Staging keeps its full 900 s ladder —
# which is right, since the ladder exists for staging's transient window and F2 is a
# different fault from billing. Reading these two columns as one outage is what cost
# two runs of triage on 2026-11-19; keeping them separate is the point.
export RETRY_NON_RETRYABLE="${RETRY_NON_RETRYABLE:-trial has expired|please select a plan}"
upload() {
  # shellcheck disable=SC2086
  bash "$SCRIPT_DIR/with-retry.sh" railway up $UPLOAD_PATH $ROOT_FLAG --no-gitignore \
    --service "$SERVICE" \
    --environment "$RAILWAY_ENV" \
    --project "$RAILWAY_PROJECT" \
    --detach \
    --verbose \
    --message "$SHA"
}

# Same document the write cell of ci-railway-token-class.yml sent (there via the
# CLI's own bearer, here via the leg's RAILWAY_TOKEN), same snake_case argument
# names. latestCommit is NOT used anywhere in this file: that spelling was
# refused `Not Authorized` three of three owner-side from 2026-11-22T13:53Z, so a
# leg built on it cannot tell a scope refusal from a shape refusal, and it also
# deploys "whatever the connection points at" rather than the reviewed SHA.
DOC_DEPLOY_SHA='mutation($s:String!,$e:String!,$sha:String!){ serviceInstanceDeploy(serviceId:$s, environmentId:$e, commitSha:$sha) }'

# The same address the mutation is aimed at, used for the reads too.
#
# `railway deployment list --service <name> --environment <name>` is what this
# file used to ask with, and on 2026-11-23T18:33:15Z it refused all three
# staging legs of train 45234100845: each printed its `=== deploying … ===`
# header and exited 1 about a second later with nothing else in the job log —
# no baseline line, no `waiting for`, no reason. The development legs of the
# same commit read their rows with the same name-resolved command (upload mode's
# poll, below, differs only in --limit and in the 2>/dev/null) and it worked:
# job 137919832426 polled 13 times, job 138112622097 polled 11, each ending with
# its own `deployed` line, so the flags, the pinned 5.40.1 binary
# and jq were all fine; the call that died was the name-resolved one, in a
# mutation job, holding RAILWAY_TOKEN_STAGING.
#
# That is not a mystery to argue with. A leg that aims itself with ids must READ
# with ids, which is also the only transport this token is measured against:
# ci-railway-token-class.yml run 45179580758 resolved a staging `serviceInstance`
# through `railway api` with RAILWAY_TOKEN_STAGING from an unlinked runner, and
# run 45194092365's write cell got the deploy mutation accepted with the same
# credential. `deployments(input:)` is the list side of the same surface
# (introspected on 5.40.1: `DeploymentListInput` takes projectId, serviceId and
# environmentId; the connection's nodes carry id, status, createdAt and `meta`,
# newest-first — the four fields staging-deploy-watch.py decides on).
#
# It also removes the second thing that made the death silent: `2>/dev/null` plus
# `set -e` meant the refusal never reached the log and the guard written for an
# unreadable baseline could not run. This function never aborts — it prints what
# happened and hands back an empty page, and the caller's existing
# `[ -n "$BASELINE_ROW" ]` refusal is what ends the leg.
DOC_ROWS='query($in:DeploymentListInput!,$n:Int){ deployments(input:$in, first:$n){ edges{ node{ id status createdAt meta } } } }'

rows_page_api() {
  # $1 = how many rows to ask for. Prints a JSON ARRAY shaped exactly like
  # `railway deployment list --json`, so one decision rule (and one set of
  # fixtures) covers both readers and switching transport cannot change a verdict.
  local limit="$1" out body rest rc=0
  # `railway api` prints the body on line 1 and its own commentary after it, and
  # appends that sentence on a non-200 — so line 1 is the only thing parsed and
  # the remainder is kept as the diagnosis (see scripts/ci/f2-token-probe.sh).
  out="$(railway api "$DOC_ROWS" --compact --allow-errors \
          --var "in={\"serviceId\":\"$SERVICE_ID\",\"environmentId\":\"$RAILWAY_ENVIRONMENT_ID\",\"projectId\":\"$RAILWAY_PROJECT\"}" \
          --var "n=$limit" 2>&1)" || rc=$?
  body="$(printf '%s\n' "$out" | sed -n '1p')"
  rest="$(printf '%s\n' "$out" | tail -n +2 | tr '\n' ' ')"
  if [ "$rc" -ne 0 ] || ! printf '%s' "$body" | jq -e 'type == "object"' >/dev/null 2>&1; then
    # >&2 on purpose: the caller captures stdout as the JSON page, and a
    # diagnostic written there becomes the first line of the page (jq then dies
    # on "row page read failed…" as if Railway had answered it, which is the
    # silent-death bug wearing a new hat). The job log still gets it, because a
    # leg runs with stderr merged.
    echo "  row page read failed (rc=$rc) service=$SERVICE_ID env=$RAILWAY_ENVIRONMENT_ID :: $(printf '%s' "${body:-<empty>} ${rest}" | cut -c1-300)" | redact >&2
    printf '[]'
    return 0
  fi
  # An errors[] envelope has no `.data`, so `// []` turns a refusal into the same
  # empty page as a genuinely row-less environment — which is the safe direction:
  # the baseline guard refuses, and the watch says `no-new-row`. Neither reads
  # green.
  printf '%s' "$body" | jq -c '[ (.data.deployments.edges // [])[] | .node ]'
}

baseline_row_id() {
  # The row that exists BEFORE the mutation. Everything the watch below learns
  # comes from comparing against this id, so a failure to read it is not a
  # blank-slate condition: an empty baseline would make the pre-existing
  # deployment look like the new one and report a leg green that deployed
  # nothing. The caller stops on empty.
  rows_page_api 1 | jq -r 'if type=="array" then (.[0].id // empty) else empty end'
}

mutate_deploy() {
  # The retry ladder here is NOT the 900 s upload budget: that exists to ride
  # out F2 on the upload-initiate endpoint, and a leg that retries a GraphQL
  # call for 15 minutes would just be a slow way of asking for a row that may
  # already exist. Three attempts, 15 s apart, because the measured failure
  # modes are (a) a transient edge refusal and (b) a permanent refusal that no
  # amount of waiting changes — for (b) the answer must reach the log while the
  # job is still interesting.
  #
  # `--allow-errors` keeps a GraphQL errors[] envelope on stdout instead of the
  # CLI exiting before printing it: `Not Authorized` arrives as HTTP 200 with an
  # errors[] body, and a leg that keys on the exit code reads that as success.
  export RETRY_ATTEMPTS="${MUT_RETRY_ATTEMPTS:-3}"
  export RETRY_BASE_DELAY_S="${MUT_RETRY_BASE_DELAY_S:-15}"
  bash "$SCRIPT_DIR/with-retry.sh" railway api "$DOC_DEPLOY_SHA" --compact --allow-errors \
    --var "s=$SERVICE_ID" --var "e=$RAILWAY_ENVIRONMENT_ID" --var "sha=$SHA"
}

if [ "$DEPLOY_METHOD" = mutation ]; then
  BASELINE_ROW="$(baseline_row_id)"
  [ -n "$BASELINE_ROW" ] || { echo "::error::could not read the pre-mutation $SERVICE/$RAILWAY_ENV deployment row; refusing to guess at 'new row'"; exit 1; }
  echo "baseline row before the mutation: $BASELINE_ROW"
  # The cutoff is taken AFTER the baseline read and BEFORE the mutation, so it
  # sits inside the window this leg owns: a row Railway minted for us is not
  # older than it, and anything from an earlier second — another train on the
  # same sha, a re-run, a console deploy — is scenery the classifier must not
  # credit. UTC, because the platform stamps createdAt in UTC and the compare is
  # lexicographic. Second resolution, and the cutoff's own second counts as
  # ours: a fast edge can mint our row in the same second this line runs, and
  # reading that as a no-op would blame Railway for our own clock.
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "mutation fired at: $STARTED_AT"
  MUTATE_OUT=""
  MUTATE_RC=0
  MUTATE_OUT="$(mutate_deploy 2>&1)" || MUTATE_RC=$?
  # Line 1 is the answer; the CLI's own commentary follows it. The verdict
  # helper is the one the probe uses, so a leg and a probe describe the same
  # refusal with the same word, and the sentinel http value is theirs too:
  # `railway api` hides the edge status, so this cell reads the BODY and nothing
  # keys on a status code here.
  printf '%s\n' "$MUTATE_OUT" | sed -n '1p' | cut -c1-400
  MUT_VERDICT="$(python3 "$SCRIPT_DIR/f2-probe-verdict.py" mutation \
    "$(printf '%s\n' "$MUTATE_OUT" | sed -n '1p')" cli-transport)"
  echo "mutation verdict: $MUT_VERDICT (exit $MUTATE_RC)"
  # A refused or unparseable mutation is a red leg NOW, not a poll timeout 10
  # minutes from now: the poll would report `no-new-row` and blame Railway for
  # our own 401.
  [ "$MUT_VERDICT" = accepted ] || {
    echo "::error::$SERVICE/$RAILWAY_ENV mutation was not accepted ($MUT_VERDICT)"
    exit 1
  }
elif [ -n "$ARCHIVE_TMP" ]; then
  (
    cd "$ARCHIVE_TMP"
    upload
  )
else
  upload
fi

dump_crash_log() {
  # This deployment never became the one serving traffic, so
  # `railway logs --deployment` (which targets the CURRENT/active deployment)
  # reports the OLD, still-running deployment's logs — silently pointing at the
  # wrong process.
  #
  # `railway logs --help`: DEPLOYMENT_ID is a bare POSITIONAL argument, not a
  # value for --deployment (which is a BOOLEAN flag selecting deploy-logs over
  # build-logs). `--deployment "$id"` silently failed with "No service linked"
  # because $id was consumed as if it were --deployment's value, leaving
  # --service/--environment/--project all unset. `--latest` ("show logs from
  # the latest deployment, even if it failed or is still building") is simpler
  # and more robust than passing the id at all. DO NOT "fix" this back to the
  # positional form.
  #
  # stderr is KEPT (redacted below, never discarded): a CLI usage error looks
  # identical to "zero log lines exist" otherwise, and those are very different
  # problems to chase.
  railway logs --deployment --latest --service "$SERVICE" \
    --environment "$RAILWAY_ENV" --project "$RAILWAY_PROJECT" \
    --lines 300 > dep.log 2>&1 || true
  echo "  fetched $(wc -l < dep.log) log lines for this deployment"
  SIG='panic:|fatal error|nil pointer|runtime error|goroutine [0-9]+ \[|listen tcp|bind: address already in use|Validate\(\)|refusing to start|exit status|SIGSEGV|SIGABRT'
  if grep -qaiE "$SIG" dep.log; then
    echo "  --- crash signatures (redacted) ---"
    grep -aiE "$SIG" dep.log | tail -60 | redact
  else
    # No known crash signature — most likely a startup HANG that never reached
    # "listening" before Railway's healthcheck timed it out, which prints no
    # panic at all. Show whatever DID print so a stuck init step is visible
    # instead of a bare "no match".
    echo "  no crash signature matched — last lines emitted before the deployment ended:"
    tail -40 dep.log | redact
  fi
}

watch_verdict=not-run
for attempt in $(seq 1 "$ATTEMPTS"); do
  if [ "$DEPLOY_METHOD" = mutation ]; then
    # One page, both calls: the verdict and the row behind it come from the same
    # snapshot, so the log line cannot describe a page the verdict never saw.
    #
    # Id-addressed, like the mutation and the baseline: the leg that name-resolved
    # this page died before it could say so (see DOC_ROWS above), and a watch that
    # reads through a different transport than the deploy it is judging is a second
    # way for the verdict and the evidence to disagree.
    rows_page="$(rows_page_api 10)"
    watch_verdict="$(python3 "$SCRIPT_DIR/staging-deploy-watch.py" watch \
                      "$rows_page" "$BASELINE_ROW" "$SHA" "${STARTED_AT:-}")"
    echo "  row under watch (id / status / commit / which): $(
      python3 "$SCRIPT_DIR/staging-deploy-watch.py" describe "$rows_page" "$BASELINE_ROW" "$SHA" "${STARTED_AT:-}" | tr '\t' ' ')"
    case "$watch_verdict" in
      deployed)
        echo "=== $SERVICE/$RAILWAY_ENV deployed $SHA (mutation) ==="
        exit 0
        ;;
      build-failed)
        echo "::error::$SERVICE/$RAILWAY_ENV deployment ended FAILED (mutation built $SHA)"
        dump_crash_log
        exit 1
        ;;
      *)
        # `pending`, `no-new-row`, `other-commit` and `rows-unparseable` all keep
        # waiting: only a row naming THIS commit with a terminal status ends
        # this leg, and a budget that runs out on `no-new-row` is the no-op the
        # mutation-mode header says must never be reported green.
        echo "  waiting for $SERVICE/$RAILWAY_ENV (attempt $attempt/$ATTEMPTS; watch: $watch_verdict)"
        sleep 15
        ;;
    esac
    continue
  fi
  # --limit 10 because the deployment may not be first in the list yet, and
  # `first // {}` so an absent row reads as an empty object rather than null.
  row="$(railway deployment list --service "$SERVICE" --environment "$RAILWAY_ENV" \
          --project "$RAILWAY_PROJECT" --limit 10 --json \
        | jq -c --arg m "$SHA" '[.[] | select(.meta.cliMessage == $m)] | first // {}')"
  status="$(printf '%s' "$row" | jq -r '.status // empty')"
  case "$status" in
    SUCCESS)
      echo "=== $SERVICE/$RAILWAY_ENV deployed $SHA ==="
      exit 0
      ;;
    FAILED|CRASHED|REMOVED)
      echo "::error::$SERVICE/$RAILWAY_ENV deployment ended with $status"
      dump_crash_log
      exit 1
      ;;
    *)
      echo "  waiting for $SERVICE/$RAILWAY_ENV (attempt $attempt/$ATTEMPTS; status: ${status:-not-found})"
      sleep 15
      ;;
  esac
done

if [ "$DEPLOY_METHOD" = mutation ]; then
  # The one line that says what the leg concluded, from BOTH cells: the
  # mutation's answer and the watch's last verdict. `mutation-is-noop` here is
  # the honest reading of "Railway said true and made no row", and it is a red
  # leg, not a timeout.
  echo "::error::$SERVICE/$RAILWAY_ENV $(python3 "$SCRIPT_DIR/staging-deploy-watch.py" final "$MUT_VERDICT" "$watch_verdict") after $((ATTEMPTS * 15))s"
  exit 1
fi

echo "::error::timed out waiting for the $SERVICE/$RAILWAY_ENV deployment after $((ATTEMPTS * 15))s"
exit 1
