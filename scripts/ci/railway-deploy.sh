#!/usr/bin/env bash
# Upload one service to one Railway environment, wait for the deployment to
# settle, and dump a REDACTED crash log when it does not.
#
# Extracted from ci.yml's three deploy jobs and development-deploy.yml, where it
# existed four times and three of the four were wrong. Two behaviours in here were
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
#
# THE UPLOAD RULE (read before changing UPLOAD_PATH or ROOT_FLAG):
#   backend            -> UPLOAD_PATH=backend        ROOT_FLAG=--path-as-root
#                         Railway builds backend/Dockerfile from the directory
#                         `railway up` uploads, so the upload root must BE backend/.
#   frontend-web       -> UPLOAD_PATH=''             ROOT_FLAG=''
#   frontend-admin     -> UPLOAD_PATH=''             ROOT_FLAG=''
#                         Both frontends carry a Railway `rootDirectory` of their
#                         own folder, so they must be uploaded from the REPO ROOT
#                         with NO positional path at all:
#                           - `railway up .` dies client-side with "prefix not
#                             found" during indexing (a CLI bug with an explicit
#                             `.` when rootDirectory is set);
#                           - `frontend-web --path-as-root` makes Railway look for
#                             `frontend-*/` inside an archive that already IS that
#                             folder.
#                         Only ci.yml's staging matrix ever got this right
#                         (ci.yml:622-637). ci.yml:563, ci.yml:790 and
#                         development-deploy.yml:98 all hardcoded --path-as-root
#                         for every service, which is why development's
#                         frontend-web deployment failed on 2026-11-13.

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

# $UPLOAD_PATH and $ROOT_FLAG are UNQUOTED ON PURPOSE: an empty value must vanish
# from the argument list, not arrive as an empty-string argument (which the CLI
# reads as a path of ""). See THE UPLOAD RULE above.
# shellcheck disable=SC2086
railway up $UPLOAD_PATH $ROOT_FLAG --no-gitignore \
  --service "$SERVICE" \
  --environment "$RAILWAY_ENV" \
  --project "$RAILWAY_PROJECT" \
  --detach \
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
