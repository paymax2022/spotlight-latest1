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
#   UPLOAD_PATH      positional path for `railway up` ('' = none)
#   ROOT_FLAG        '--path-as-root' or ''
#   BUILD_DIR        when set, $SHA is written to $BUILD_DIR/BUILD_COMMIT first
#   ATTEMPTS         poll attempts, 15s apart (default 40 = 10 minutes)
#   RAILWAY_HTTP_TIMEOUT  set by the caller; the CLI default of 90s truncates the
#                    110 MB frontend-web upload
#   RETRY_ATTEMPTS / RETRY_BASE_DELAY_S  passed to scripts/ci/with-retry.sh for
#                    the upload call (defaults here: 9 attempts, 60s base = 900 s
#                    of guaranteed backoff, sized to the measured fault window —
#                    see THE UPLOAD BUDGET below)
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
ATTEMPTS="${ATTEMPTS:-40}"

# Never printed, never logged. Referenced only so a missing token fails here with
# a clear name rather than deep inside the CLI.
[ -n "$RAILWAY_TOKEN" ] || { echo "::error::RAILWAY_TOKEN is empty for $RAILWAY_ENV/$SERVICE"; exit 1; }

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
if [ -n "$BUILD_DIR" ]; then
  printf '%s' "$SHA" > "$BUILD_DIR/BUILD_COMMIT"
  echo "stamped $BUILD_DIR/BUILD_COMMIT"
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
# shellcheck disable=SC2086
bash "$SCRIPT_DIR/with-retry.sh" railway up $UPLOAD_PATH $ROOT_FLAG --no-gitignore \
  --service "$SERVICE" \
  --environment "$RAILWAY_ENV" \
  --project "$RAILWAY_PROJECT" \
  --detach \
  --verbose \
  --message "$SHA"

for attempt in $(seq 1 "$ATTEMPTS"); do
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
      exit 1
      ;;
    *)
      echo "  waiting for $SERVICE/$RAILWAY_ENV (attempt $attempt/$ATTEMPTS; status: ${status:-not-found})"
      sleep 15
      ;;
  esac
done

echo "::error::timed out waiting for the $SERVICE/$RAILWAY_ENV deployment after $((ATTEMPTS * 15))s"
exit 1
