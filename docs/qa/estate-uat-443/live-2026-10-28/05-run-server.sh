#!/usr/bin/env bash
# Start the Phase 2.5a backend for the inbox archive / search / pin / retention HTTP lane.
#
#   bash docs/qa/estate-uat-443/live-2026-10-28/05-run-server.sh
#
# A distinct binary name (server-phase25a.exe) so this lane can never be run against a Phase 2.3 or 2.4
# build, on :8095 — the estate lane's port. :8091/:8093/:8094 carry long-running dev instances from other
# sessions and are left alone, as is the :3000 next dev the BFF half of this lane attaches to.
#
# Env comes from the gitignored /tmp app.env (local Supabase + sandbox provider keys), then the flags this
# slice needs are forced:
#   FEATURE_ESTATE_ENABLED               — mounts /api/finance/estate/** at all
#   FEATURE_ESTATE_LIFECYCLE_ENABLED     — mounts /estate-admin/estates/** so the lane can publish the
#                                          estate it creates (pending -> active is the precondition for
#                                          any notification *write*) and set/unset legal hold
#   FEATURE_ESTATE_VERIFICATION_REQUIRED — new estates start 'pending', which is what lets the lane prove
#                                          the notification routes inherit the lifecycle gate
set -euo pipefail

WORK="${WORK:-/tmp/estate-uat-live}"
PORT="${PORT:-8095}"
REPO="${REPO:-.}"

set -a
# shellcheck disable=SC1091
source "$WORK/app.env"
set +a

export APP_PORT="$PORT"
export FEATURE_ESTATE_ENABLED=true
export FEATURE_ESTATE_LIFECYCLE_ENABLED=true
export FEATURE_ESTATE_VERIFICATION_REQUIRED=true

echo "building server binary into $WORK/server-phase25a.exe"
( cd "$REPO/backend" && go build -o "$WORK/server-phase25a.exe" ./cmd/server )

echo "starting backend on :$PORT (estate=on lifecycle=on verification_required=on)"
exec "$WORK/server-phase25a.exe"
