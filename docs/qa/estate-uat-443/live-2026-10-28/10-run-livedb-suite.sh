#!/usr/bin/env bash
# Phase 2.5a — run the estate inbox archive / retention live-DB suite and keep its transcript.
#
# These are the service-level tests behind the HTTP lane (06-probe-notifications.sh): same fixture shape,
# but driving the Go service straight against the local database, so a failure names the query rather than
# a status code. The suite is gated on TEST_DATABASE_URL — without it every test SKIPs and the lane would
# report ten green lines that tested nothing, which is why the gate is echoed into the transcript header.
#
# Run:  bash docs/qa/estate-uat-443/live-2026-10-28/10-run-livedb-suite.sh
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$DIR/../../../.." && pwd)}"
OUT="${OUT:-$DIR/livedb-notifications-phase2.5a.out}"
DBURL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres}"
RUN='TestLiveDB_Inbox|TestLiveDB_NotificationRetention|TestLiveDB_NotificationPurge'

{
  echo "=== Phase 2.5a live-DB suite at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "--- TEST_DATABASE_URL=$DBURL   (local supabase db, container supabase_db_spotlight)"
  echo "--- cwd=$REPO/backend"
  echo "--- go test ./internal/estate/ -count=1 -run '$RUN' -v"
  echo "--- guard-message assertions in this run expect the reason-specific text that the re-applied"
  echo "+++ 20271099000070 now raises ('because it is pinned' / 'because its category % is protected')"
} > "$OUT"

cd "$REPO/backend" || { echo "no backend directory" | tee -a "$OUT"; exit 1; }
TEST_DATABASE_URL="$DBURL" go test ./internal/estate/ -count=1 -run "$RUN" -v >> "$OUT" 2>&1
RC=$?

{
  echo "--- suite exit code: $RC"
  echo "--- tallies: PASS=$(grep -c '^--- PASS' "$OUT") FAIL=$(grep -c '^--- FAIL' "$OUT") SKIP=$(grep -c '^--- SKIP' "$OUT")"
} >> "$OUT"

echo "wrote $OUT (exit $RC)"
exit $RC
