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
# mobile-app/reactnative/scripts/check-web-api.mjs, which hands the same guard to
# this script whenever the Expo app comes up and nothing owns :3000 — so a
# hand-started `npm run web` gets the same stand-down rules and the same restarts.
#
# Usage: scripts/dev/web-supervisor.sh     (called by `make dev`; idempotent)

# NOT `set -e`: a server that exits is the event this loop exists to handle.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Overridable so the stand-down and give-up paths below can be exercised without
# breaking a real checkout (WEB_DIR=/tmp/empty scripts/dev/web-supervisor.sh).
WEB_DIR="${WEB_DIR:-$REPO/frontend-web}"
STATE_CLI="$REPO/scripts/dev/web-server-state.mjs"
WEB_PORT="${WEB_PORT:-3000}"
RETRY_DELAY="${RETRY_DELAY:-3}"
FAST_FAILURE_SECONDS="${FAST_FAILURE_SECONDS:-10}"
MAX_FAST_FAILURES="${MAX_FAST_FAILURES:-3}"

# Asks the shared probe (scripts/dev/web-server-state.mjs) instead of checking the
# port here: Next 16 refuses a second dev server per CHECKOUT via
# frontend-web/.next/dev/lock, so an orphan on :3002 blocks a start while
# :${WEB_PORT} sits free. Probing only the port is what turned that orphan into
# three fast "crashes" and a false "broken checkout" on 2026-11-12.
#
# Sets STATE_LINE for the caller. Claimed on any answer except a clean "free":
# a probe that cannot run is not evidence that starting a duplicate is safe.
dev_server_state() {
  local code
  STATE_LINE="$(node "$STATE_CLI" --web-dir "$WEB_DIR" --port "$WEB_PORT" 2>&1)"
  code=$?
  case "$code" in
    1) return 1 ;;
    0 | 2) return 0 ;;
    *) STATE_LINE="web-server-state could not run (exit $code) — treating the checkout as claimed"
       return 0 ;;
  esac
}

if dev_server_state; then
  echo "    frontend-web: $STATE_LINE"
  echo "    Not starting a second server. If the app cannot reach that one, stop it"
  echo "    (kill the pid above) and run \`make dev\` again — the mobile app only calls :$WEB_PORT."
  exit 0
fi

fails=0
while :; do
  started_at=$(date +%s)
  ( cd "$WEB_DIR" && npm run dev )
  spent=$(( $(date +%s) - started_at ))

  # Wait out our own socket teardown before deciding the port is somebody else's:
  # probing immediately can hit a connection reset from the server that just died,
  # and a slow answer counts as "claimed".
  sleep "$RETRY_DELAY"

  # Something else holds the checkout now (another terminal, a restarted `make dev`,
  # or a duplicate that slid onto its own port). Stand down instead of stacking a
  # second Next on a port the app will never talk to.
  if dev_server_state; then
    echo "    frontend-web: $STATE_LINE"
    echo "    frontend-web: another dev server holds the checkout now — supervisor stopping."
    exit 0
  fi

  if [ "$spent" -lt "$FAST_FAILURE_SECONDS" ]; then
    fails=$(( fails + 1 ))
  else
    fails=0
  fi

  if [ "$fails" -ge "$MAX_FAST_FAILURES" ]; then
    echo "    frontend-web: $fails exits in under ${FAST_FAILURE_SECONDS}s — giving up."
    echo "    Two things do this, and the first is the one that fakes a crash:"
    echo "      1. another dev server owns this checkout. Next's refusal to share it looks"
    echo "         exactly like a crash and finishes in seconds. Ask again:"
    echo "         node scripts/dev/web-server-state.mjs --web-dir $WEB_DIR --port $WEB_PORT"
    echo "         If that says claimed, kill the pid it names instead of starting another."
    echo "      2. a genuinely broken checkout. Check:"
    echo "         cd $WEB_DIR && npm install"
    echo "      and in a fresh worktree, copy the gitignored .env.local from a checkout"
    echo "      that already has one."
    exit 1
  fi

  echo "    frontend-web: exited after ${spent}s — restarting."
done
