#!/usr/bin/env bash
#
# web-supervisor — run frontend-web (:3000) for `make dev`, and bring it straight
# back when it dies.
#
# WHY THIS EXISTS
# ----------------
# Every request the mobile app makes goes through frontend-web: src/api/client.ts
# reads EXPO_PUBLIC_API_BASE_URL, local dev pins that to http://localhost:3000,
# and :3000 is the only home for the /api/v1/* proxies (maps, payments, crypto,
# doctor) that the Go backend does not serve itself. It is a plain `next dev` that
# dies on its own, and while it was dead the doctor wizard showed "We could not
# load your documents" over ERR_CONNECTION_REFUSED with nothing in the backend
# log — the failure looks like an app bug, not a stopped dev server.
#
# A LaunchAgent was tried first and cannot work here: macOS TCC denies background
# items every read under ~/Documents, where this repo lives. A job whose entry
# point was inside the repo exited 126, and a job running from /tmp hit "Operation
# not permitted" just listing the repo. A shell started from your terminal already
# holds that access, so supervision belongs here — inside `make dev`'s lifetime —
# rather than in a privacy grant weakened for the whole machine.
#
# Coverage therefore ends when `make dev` stops. Starting up is covered by
# mobile-app/reactnative/scripts/check-web-api.mjs, which launches this same
# server whenever the Expo app comes up and nothing is serving :3000.
#
# Usage: scripts/dev/web-supervisor.sh     (called by `make dev`; idempotent)

# NOT `set -e`: a server that exits is the event this loop exists to handle.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Overridable so the give-up path below can be exercised without breaking a real
# checkout (WEB_DIR=/tmp/empty scripts/dev/web-supervisor.sh).
WEB_DIR="${WEB_DIR:-$REPO/frontend-web}"
URL='http://localhost:3000/'
RETRY_DELAY=3
FAST_FAILURE_SECONDS=10
MAX_FAST_FAILURES=3

# True while something listens on :3000. A slow reply counts as claimed: mid-compile
# Next holds the port and answers late, and reading that as "free" starts a duplicate
# that slides to the next open port and talks to nothing the app will ever call. Only
# curl's "connection refused" (exit 7) proves the port is unclaimed.
port_claimed() {
  local attempt code status
  for attempt in 1 2; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL" 2>/dev/null)"
    status=$?
    if [ "$status" -ne 7 ]; then
      [ "$status" -eq 0 ] && [ "$code" = "000" ] || return 0
    elif [ "$attempt" -eq 1 ]; then
      sleep 1
    fi
  done
  return 1
}

if port_claimed; then
  echo "    frontend-web: :3000 already answers — not starting a second server."
  exit 0
fi

fails=0
while :; do
  started_at=$(date +%s)
  ( cd "$WEB_DIR" && npm run dev )
  spent=$(( $(date +%s) - started_at ))

  # Wait out our own socket teardown before deciding the port is somebody else's:
  # probing immediately can hit a connection reset from the server that just died,
  # and a slow answer counts as "claimed" above.
  sleep "$RETRY_DELAY"

  # Something else holds the port now (another terminal, a restarted `make dev`).
  # Stand down instead of stacking a second Next on an auto-picked port the app
  # will never talk to.
  if port_claimed; then
    echo "    frontend-web: :3000 is held by another process now — supervisor stopping."
    exit 0
  fi

  if [ "$spent" -lt "$FAST_FAILURE_SECONDS" ]; then
    fails=$(( fails + 1 ))
  else
    fails=0
  fi

  if [ "$fails" -ge "$MAX_FAST_FAILURES" ]; then
    echo "    frontend-web: $fails exits in under ${FAST_FAILURE_SECONDS}s — giving up."
    echo "    That is a broken checkout, not a crash. Check:"
    echo "      cd $WEB_DIR && npm install"
    echo "    and in a fresh worktree, copy the gitignored .env.local from a checkout"
    echo "    that already has one."
    exit 1
  fi

  echo "    frontend-web: exited after ${spent}s — restarting."
done
