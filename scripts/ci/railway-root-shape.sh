#!/usr/bin/env bash
# railway-root-shape.sh — print the `railway up` shape for one service in one
# environment, derived from that instance's LIVE Railway `rootDirectory`.
#
# Emits three eval-able lines on stdout and nothing else; explanations go to
# stderr so `eval "$(bash scripts/ci/railway-root-shape.sh)"` stays clean:
#
#   UPLOAD_PATH='<folder>'   ROOT_FLAG='--path-as-root'   BUILD_DIR=''
#   UPLOAD_PATH=''           ROOT_FLAG=''                 BUILD_DIR=backend
#
# WHY DERIVE IT INSTEAD OF WRITING IT DOWN
# scripts/ci/railway-deploy.sh's THE UPLOAD RULE records both failure shapes, and
# both of them report a SUCCESSFUL upload:
#   - repo root where the instance has NO rootDirectory builds the MONOREPO; the
#     app comes up and 404s everything (development's smoke failed with
#     "/admin/login answered 404" on 2026-11-16; the same commit re-uploaded with
#     --path-as-root returned 200 on that same host).
#   - a service folder where the instance HAS a rootDirectory dies client-side with
#     "prefix not found", because Railway looks for `frontend-*/` inside an archive
#     that already is that folder.
# release.yml hardcodes the answer in three matrices and its header carries the
# measurement. A manual lane — the production frontend-web upload that
# docs/ops/admin-console-production-errors-2026-11-20.md calls Command 6 — has no
# matrix to copy, so it asks Railway instead of trusting a note.
#
# Measured 2026-11-22 with the same query this script runs, project
# e7dca861-3667-4d9a-8090-6d2f4d179ec2:
#     staging      frontend-web -> 'frontend-web'   frontend-admin -> 'frontend-admin'   backend -> null
#     development  all three -> null
#     production   all three -> null
#
# THE GUARD THAT MATTERS: a rootDirectory naming a directory that is not in the
# repo cannot be honoured by uploading anything in this tree, and Railway builds an
# EMPTY context happily — green pipeline, nothing deployed. That is refused here
# rather than passed through. (scripts/ci/test-railway-root-shape.sh pins all of
# this; case 5 is that guard.)
#
# Required env:
#   SERVICE          the Railway service name (also the repo directory when unset)
#   RAILWAY_ENV      development | staging | production
#   RAILWAY_PROJECT  project id
# Run from the repository root.
set -euo pipefail

: "${SERVICE:?required: SERVICE}"
: "${RAILWAY_ENV:?required: RAILWAY_ENV}"
: "${RAILWAY_PROJECT:?required: RAILWAY_PROJECT}"

command -v railway >/dev/null || { echo "railway-root-shape: the railway CLI is not on PATH" >&2; exit 1; }
command -v jq >/dev/null || { echo "railway-root-shape: jq is required" >&2; exit 1; }

QUERY='query($p:String!){ project(id:$p){ environments(first:50){ edges{ node{ name serviceInstances(first:50){ edges{ node{ rootDirectory service{ name } } } } } } } } }'

# `--compact` keeps the answer on one line in a job log; jq accepts either shape.
if ! json="$(railway api "$QUERY" --var "p=$RAILWAY_PROJECT" --compact 2>/dev/null)"; then
  echo "railway-root-shape: 'railway api' failed for project $RAILWAY_PROJECT (is RAILWAY_TOKEN set and valid?)" >&2
  exit 1
fi

root="$(printf '%s' "$json" \
  | jq -r --arg env "$RAILWAY_ENV" --arg svc "$SERVICE" '
      [ .data.project.environments.edges[]?
        | select(.node.name == $env)
        | .node.serviceInstances.edges[]?
        | select(.node.service.name == $svc)
        | (.node.rootDirectory // "")
      ] | if length == 0 then "__ABSENT__" else .[0] end' 2>/dev/null)" || root="__BAD_JSON__"

case "$root" in
  __ABSENT__)
    echo "railway-root-shape: no service instance named $SERVICE in environment $RAILWAY_ENV - refusing to invent a shape" >&2
    exit 1
    ;;
  __BAD_JSON__)
    echo "railway-root-shape: 'railway api' did not answer with readable JSON - refusing to guess the shape" >&2
    exit 1
    ;;
esac

BUILD_DIR=''
[ "$SERVICE" = backend ] && BUILD_DIR=backend

if [ -z "$root" ]; then
  # Unset rootDirectory: the archive root has to BE the app folder.
  [ -d "$SERVICE" ] || { echo "railway-root-shape: $SERVICE has no rootDirectory and no $SERVICE/ directory exists in this tree" >&2; exit 1; }
  echo "railway-root-shape: $RAILWAY_ENV/$SERVICE rootDirectory unset -> shipping $SERVICE/ as the archive root (--path-as-root)" >&2
  printf "UPLOAD_PATH='%s'\n" "$SERVICE"
  printf "ROOT_FLAG='%s'\n" '--path-as-root'
else
  # rootDirectory set: Railway resolves that path INSIDE the archive, so the
  # archive must be the repo root.
  [ -d "$root" ] || { echo "railway-root-shape: $RAILWAY_ENV/$SERVICE rootDirectory is '$root' but this repo has no '$root' directory - refusing (Railway would build an empty context and report SUCCESS)" >&2; exit 1; }
  echo "railway-root-shape: $RAILWAY_ENV/$SERVICE rootDirectory '$root' -> shipping the repo root (no --path-as-root)" >&2
  printf "UPLOAD_PATH='%s'\n" ''
  printf "ROOT_FLAG='%s'\n" ''
fi
printf "BUILD_DIR='%s'\n" "$BUILD_DIR"
