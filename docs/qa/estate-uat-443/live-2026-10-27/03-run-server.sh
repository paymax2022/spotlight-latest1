#!/usr/bin/env bash
# Start the Phase 2.3 backend for the profile / ownership-governance HTTP lane.
#
# Port 8095 is deliberate: 8091/8093/8094 already carry long-running local dev instances from other
# sessions, and this lane must not disturb them. The binary is built into the scratch work dir, never
# into the repo.
#
#   bash docs/qa/estate-uat-443/live-2026-10-27/03-run-server.sh
#
# Env comes from the gitignored /tmp app.env (local Supabase + sandbox provider keys), then the three
# flags this slice needs are forced:
#   FEATURE_ESTATE_ENABLED              — mounts /api/finance/estate/** at all
#   FEATURE_ESTATE_LIFECYCLE_ENABLED    — mounts the /api/finance/estate-admin/estates/** review queue
#   FEATURE_ESTATE_VERIFICATION_REQUIRED— new estates start 'pending', so publish/verify/reject are
#                                         reachable over HTTP instead of only in the Go tests
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

if [ ! -x "$WORK/server-phase23.exe" ]; then
  echo "building server binary into $WORK"
  ( cd "$REPO/backend" && go build -o "$WORK/server-phase23.exe" ./cmd/server )
fi

echo "starting backend on :$PORT (lifecycle=on verification_required=on)"
exec "$WORK/server-phase23.exe"
