#!/usr/bin/env bash
# Resolve a *verified* Next.js surface for the Phase 2.5a inbox lane, then run 08 against it.
#
#   bash docs/qa/estate-uat-443/live-2026-10-28/08b-run-web.sh
#
# What this lane needs is not "a" web server but one that is demonstrably running this checkout's
# `app/api/v1/estate/**`. The first real run of 08 could not tell that, and paid for it twice over: it also
# used the wrong caller identities, so its transcript read like ~100 contract defects when it was one
# harness defect (see the header of 08-probe-notifications-bff.sh). This file therefore states, in the log,
# which server it chose and how it proved the server is this project.
#
# How the surface is chosen, in order:
#   1. WEB_BASE — an explicit override, always verified, never trusted.
#   2. The dev lock this project writes at frontend-web/.next/dev/lock: if it names a live pid whose
#      command line contains this frontend-web directory, that server *is* this checkout. Next 16 refuses a
#      second `next dev` in the same project for exactly this reason, so reusing it is the intended
#      behaviour, not a shortcut — but only once the process identity and the compiled contract agree.
#   3. Otherwise the lane starts its own `next dev` on :$PORT, records the pid, and stops it in the EXIT
#      trap so no orphan listener is left behind for the next session to misread.
#
# Verification, in all three modes: the notification route must answer 401 with no token (the handler
# compiled and is mounted; a stale/absent route would 404), and 08's own section 1 then asserts the
# Phase 2.5a feed envelope and that the rows come back for the lane estate. Two independent checks, one on
# the process and one on the contract.
#
# Ports another session owns are never killed: :3000 / :3001 are reported and, if chosen, chosen *with*
# proof. No estate feature flag is needed — these routes gate on auth + membership only.
set -uo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
WORK="${WORK:-/tmp/estate-uat-live}"
PORT="${PORT:-3005}"
WEB_DIR="$REPO/frontend-web"
LOCK="$WEB_DIR/.next/dev/lock"
LOG="$WORK/web-phase25a.log"
PIDFILE="$WORK/web-phase25a.pid"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$WORK"

[ -f "$WEB_DIR/package.json" ] && [ -f "$WEB_DIR/node_modules/next/dist/bin/next" ] || {
  echo "ABORT: $WEB_DIR is not this checkout's frontend-web with next installed (REPO=$REPO)"; exit 97; }

listening_pid() { # <port> -> pid listening on TCP, empty if none
  netstat -ano 2>/dev/null | tr -d '\r' | awk -v p="$1" '
    $1 == "TCP" { split($2, a, ":"); if (a[length(a)] == p && $4 == "LISTENING") { print $5; exit } }'
}

proc_cmdline() { # <pid> -> command line, empty if the pid is gone
  powershell -NoProfile -Command "try { (Get-CimInstance Win32_Process -Filter 'ProcessId=$1').CommandLine } catch { '' }" 2>/dev/null \
    | tr -d '\r' | head -1
}

route_mounted() { # <base> -> 0 when the notification handler answers 401 with no token
  local code
  code=$(curl -sS -m 90 -o "$WORK/route-check.json" -w '%{http_code}' "$1/api/v1/estate/notifications" 2>/dev/null || echo 000)
  echo "  route check $1/api/v1/estate/notifications -> HTTP $code"
  [ "$code" = "401" ]
}

WEB_PID=""
own_server() { # stop the dev server this script started, never anyone else's
  if [ -n "$WEB_PID" ] && kill -0 "$WEB_PID" 2>/dev/null; then
    echo "stopping the lane's next dev pid=$WEB_PID"
    kill "$WEB_PID" 2>/dev/null || true
    sleep 3
    kill -0 "$WEB_PID" 2>/dev/null && kill -9 "$WEB_PID" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
}
trap own_server EXIT

pick_reused() { # -> prints "<base> <pid>" when a live dev server for THIS project can be verified
  [ -f "$LOCK" ] || return 1
  local lock_pid lock_port cmd win_dir
  lock_pid=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid)}catch(e){console.log("")}' "$LOCK")
  lock_port=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port)}catch(e){console.log("")}' "$LOCK")
  [ -n "$lock_pid" ] && [ -n "$lock_port" ] || return 1
  # The lock is only a claim: it survives a crashed server, so require that the same pid is still the one
  # holding that port before believing anything about it.
  [ "$(listening_pid "$lock_port")" = "$lock_pid" ] || { echo "  lock names pid=$lock_pid on :$lock_port, which is not what is listening there" >&2; return 1; }
  cmd=$(proc_cmdline "$lock_pid")
  # Compare in the form Windows reports it: the lock's process line is a backslashed path, this script's
  # $WEB_DIR is a Git Bash mount path, and matching those two literally never succeeds.
  win_dir=$(cygpath -w "$WEB_DIR" | tr '\\' '/')
  case "${cmd//\\//}" in
    *"$win_dir"*) echo "http://127.0.0.1:$lock_port $lock_pid" ;;
    *) echo "  pid=$lock_pid is listening on :$lock_port but is not started from $win_dir" >&2; return 1 ;;
  esac
}

if [ "${WEB_BASE:-}" != "" ]; then
  BASE="$WEB_BASE"
  echo "=== web surface: explicit WEB_BASE override $BASE (verified below, not trusted)"
else
  REUSED=$(pick_reused || true)
  if [ -n "$REUSED" ]; then
    BASE=${REUSED% *}; REUSED_PID=${REUSED##* }
    echo "=== web surface: reusing the dev server this project already runs"
    echo "  lock:  $LOCK -> pid=$REUSED_PID port=${BASE##*:}"
    echo "  proof: its command line is inside $WEB_DIR"
    echo "         $(proc_cmdline "$REUSED_PID" | cut -c1-160)"
    route_mounted "$BASE" || { echo "ABORT: the locked dev server does not mount the notification route"; exit 96; }
  else
    BASE="http://127.0.0.1:$PORT"
    echo "=== web surface: no verified dev server for this project, starting one on :$PORT"
    for p in 3000 3001; do
      [ -n "$(listening_pid "$p")" ] && echo "  note: :$p is another process ($(listening_pid "$p")) — left alone, not used"
    done
    if [ -n "$(listening_pid "$PORT")" ]; then
      echo "ABORT: :$PORT is occupied by pid $(listening_pid "$PORT") and the dev lock did not vouch for it."
      echo "  Attach deliberately with WEB_BASE=http://127.0.0.1:<port>, or choose PORT=3006."
      exit 94
    fi
    : > "$LOG"
    ( cd "$WEB_DIR" && node ./node_modules/next/dist/bin/next dev -p "$PORT" ) >>"$LOG" 2>&1 &
    WEB_PID=$!
    echo "$WEB_PID" > "$PIDFILE"
    echo "  started pid=$WEB_PID, log $LOG"
    DEADLINE=$((SECONDS + 300)); READY=000
    while [ "$SECONDS" -lt "$DEADLINE" ]; do
      kill -0 "$WEB_PID" 2>/dev/null || { echo "ABORT: next dev exited early; last lines:"; tail -20 "$LOG"; exit 95; }
      READY=$(curl -sS -m 60 -o "$WORK/route-check.json" -w '%{http_code}' "$BASE/api/v1/estate/notifications" 2>/dev/null || echo 000)
      [ "$READY" = "401" ] && break
      sleep 3
    done
    [ "$READY" = "401" ] || { echo "ABORT: route never answered 401 (last $READY); last lines:"; tail -30 "$LOG"; exit 96; }
    echo "  ready: $BASE compiles the notification route (401 without a token)"
  fi
fi

echo
echo "=== running 08-probe-notifications-bff.sh against $BASE"
BASE="$BASE" bash "$DIR/08-probe-notifications-bff.sh"
PROBE=$?
echo "=== probe exit=$PROBE (web surface: $BASE)"
exit "$PROBE"
