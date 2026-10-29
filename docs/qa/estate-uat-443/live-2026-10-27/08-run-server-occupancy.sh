#!/usr/bin/env bash
# Start the Phase 2.4 backend for the unit-occupancy / dues-exemption / proof HTTP lane.
#
# A distinct binary name (server-phase24.exe) so this lane can never be run against a stale Phase 2.3
# build, and a distinct port is not needed — :8095 is this estate lane's port; 8091/8093/8094 belong to
# other sessions and are left alone.
#
#   bash docs/qa/estate-uat-443/live-2026-10-27/08-run-server-occupancy.sh
#
# Env comes from the gitignored /tmp app.env (local Supabase + sandbox provider keys), then the flags
# this slice needs are forced:
#   FEATURE_ESTATE_ENABLED               — mounts /api/finance/estate/** at all
#   FEATURE_ESTATE_LIFECYCLE_ENABLED     — mounts /api/finance/estate-admin/estates/** so the lane can
#                                          publish the estate it created and reach the write path
#   FEATURE_ESTATE_VERIFICATION_REQUIRED — new estates start 'pending', which is what proves the
#                                          occupancy routes inherit the lifecycle gate
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

echo "building server binary into $WORK/server-phase24.exe"
( cd "$REPO/backend" && go build -o "$WORK/server-phase24.exe" ./cmd/server )

echo "starting backend on :$PORT (estate=on lifecycle=on verification_required=on)"
exec "$WORK/server-phase24.exe"
