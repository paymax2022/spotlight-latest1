#!/usr/bin/env bash
#
# ensure-dev-stack — bring the dev stack up, and keep it up.
#
# WHY THIS EXISTS
# ----------------
# `dev-all.sh` is the terminal launcher. It frees its ports before binding them,
# then blocks in `wait` and kills the whole process group on Ctrl-C. That is right
# for a terminal you own and wrong for "start the stack every time Qoder opens":
# re-running it would kill dev servers another terminal already holds, and a
# launcher that must stay in the foreground cannot be called from a SessionStart
# hook (which has to return immediately and say nothing).
#
# This is the idempotent form of the same stack. Anything already answering is
# left exactly as it is — this script never kills or restarts a service it did not
# start. It only fills gaps, detached, each with its own log, and re-fills them if
# they die later.
#
#   backend  :8080   docker compose up -d api redis     (the same thing `make dev` does)
#   web      :3000   cd frontend-web          && npm run dev
#   admin    :3001   cd frontend-admin        && npm run dev
#   mobile   :8083   cd mobile-app/reactnative && npm run web
#
# Two findings that changed the port map from dev-all.sh's header comment:
#   * The Go backend listens on APP_PORT, which defaults to 8080
#     (backend/internal/config/config.go). dev-all.sh probes :8091, so its
#     "backend healthy on :8091" branch can never be true on this .env, and
#     `make run` here dies on "listen tcp :8080: bind: address already in use"
#     whenever the compose api container is up. :8091 survives only in mobile
#     fallback literals (src/lib/serverProfile.ts) and e2e specs; every running
#     client resolves the API base from EXPO_PUBLIC_API_BASE_URL first.
#   * :3000 and :3001 are probed with scripts/dev/web-server-state.mjs, not with a
#     port check, for the reason that file documents: Next refuses a second dev
#     server per checkout (frontend-*/.next/dev/lock), so a server that slid to
#     another port is invisible to a port probe and looks free when it is not.
#
# A LaunchAgent is not used: scripts/dev/web-supervisor.sh records that macOS TCC
# denies background items every read under ~/Documents, so a job whose entry point
# lives in this repo exits 126. The watchdog is instead started from a shell that
# already holds that access — Qoder's SessionStart hook, or your terminal.
#
# Usage:
#   scripts/dev/ensure-dev-stack.sh            # hook entry: make sure the watchdog
#                                              # is running, then exit silently
#   scripts/dev/ensure-dev-stack.sh --status   # one line per service
#   scripts/dev/ensure-dev-stack.sh --once     # one sweep in the foreground
#   scripts/dev/ensure-dev-stack.sh --stop     # stop the watchdog only; running
#                                              # services and containers are left alone
#
# State and logs: ~/Library/Logs/spotlight-dev/ (outside the repo, so a sweep
# never dirties `git status`). Override with DEV_STACK_DIR.

# NOT `set -e`: a service being down is the event this script exists to handle.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# This script's own absolute path, not REPO/scripts/dev: the daemon is exec'd
# through $SELF, so a relative or symlinked invocation still matches the command
# line pgrep looks for below. Reconstructing it from REPO only works while the
# file happens to live where REPO says it does.
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
STATE_DIR="${DEV_STACK_DIR:-$HOME/Library/Logs/spotlight-dev}"
WATCHDOG_PID="$STATE_DIR/watchdog.pid"
SPAWN_LOCK="$STATE_DIR/.spawn.lock"

# A hook subprocess does not inherit your interactive PATH.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SWEEP_INTERVAL="${DEV_STACK_INTERVAL:-30}"   # seconds between watchdog sweeps
FAST_WINDOW_SECONDS=120                       # restarts counted inside this window
MAX_FAST_RESTARTS=3                           # then hold off instead of hammering

SERVICES=(backend web admin mobile)

ts() { date '+%Y-%m-%d %H:%M:%S'; }

wlog() { printf '%s %s\n' "$(ts)" "$*" >> "$STATE_DIR/watchdog.log"; }

# mtime_seconds <path> — best-effort age of a file or directory.
mtime_seconds() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}

# ours_alive <name> — is the process WE started for <name> still running?
ours_alive() {
  local pidf="$STATE_DIR/$1.pid" pid
  [ -f "$pidf" ] || return 1
  pid="$(cat "$pidf" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

# note_restarts <name> — crash-loop guard. Echoes a reason and returns 1 when a
# start must be held off.
note_restarts() {
  local name="$1" stamp="$STATE_DIR/$1.restart" now count first
  now="$(date +%s)"
  count=0; first=$now
  if [ -f "$stamp" ] && read -r count first < "$stamp" 2>/dev/null; then
    [ "$count" -gt 0 ] 2>/dev/null || { count=0; first=$now; }
    if [ $((now - first)) -gt "$FAST_WINDOW_SECONDS" ]; then
      count=0; first=$now
    fi
  fi
  count=$((count + 1))
  printf '%s %s\n' "$count" "$first" > "$stamp"
  if [ "$count" -gt "$MAX_FAST_RESTARTS" ]; then
    echo "held off: more than $MAX_FAST_RESTARTS starts in ${FAST_WINDOW_SECONDS}s — read $STATE_DIR/$name.log instead of stacking more"
    return 1
  fi
  return 0
}

# start_detached <name> <dir> <command...> — one service, logged, survives us.
start_detached() {
  local name="$1" dir="$2"; shift 2
  local log="$STATE_DIR/$name.log"
  {
    echo ""
    echo "=== $(ts) ensure-dev-stack: starting $name — $* (in $dir) ==="
  } >> "$log"
  (
    cd "$dir" || exit 1
    nohup "$@" >> "$log" 2>&1 &
    echo "$!" > "$STATE_DIR/$name.pid"
  )
}

# ---------------------------------------------------------------- probes ----
# Each probe echoes "up — …", "free — …", or "unknown — …". Anything that is not
# a clean "free" is a reason NOT to start, so an unprovable state never becomes a
# duplicate server.

probe_backend() {
  if curl -sf -o /dev/null --max-time 3 http://127.0.0.1:8080/api/v1/public/health \
     || curl -sf -o /dev/null --max-time 3 http://127.0.0.1:8080/api/v1/mobile/health; then
    echo "up — :8080 health answers (compose api)"; return
  fi
  if docker info >/dev/null 2>&1; then
    echo "free — docker up, api not answering on :8080"
  else
    echo "unknown — docker daemon is not reachable"
  fi
}

probe_next() {   # $1 = app dir, $2 = port
  local out rc
  out="$(node "$REPO/scripts/dev/web-server-state.mjs" --web-dir "$REPO/$1" --port "$2" 2>&1)"
  rc=$?
  case "$rc" in
    0) echo "up — $out" ;;
    1) echo "free — $out" ;;
    *) echo "unknown — $out" ;;
  esac
}

probe_http() {   # $1 = port
  if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$1/"; then
    echo "up — :$1 answers"; return
  fi
  echo "free — :$1 refused"
}

probe_service() {
  case "$1" in
    backend) probe_backend ;;
    web)     probe_next frontend-web 3000 ;;
    admin)   probe_next frontend-admin 3001 ;;
    mobile)  probe_http 8083 ;;
  esac
}

# ------------------------------------------------------------- one sweep ----

sweep_service() {
  local name="$1" verdict msg
  verdict="$(probe_service "$name")"
  case "$verdict" in
    up* | unknown*)
      [ "${verdict#unknown}" = "$verdict" ] || wlog "$name: $verdict"
      return 0
      ;;
  esac

  # Free. If what we started is still coming up, let it finish.
  if ours_alive "$name"; then
    wlog "$name: $verdict — our pid $(cat "$STATE_DIR/$name.pid") is still booting, not starting another"
    return 0
  fi
  rm -f "$STATE_DIR/$name.pid"

  # The api container needs the Docker daemon running before compose can help.
  if [ "$name" = backend ] && ! docker info >/dev/null 2>&1; then
    wlog "backend: docker daemon not reachable — asking Docker Desktop to start, retrying next sweep"
    open -a Docker >/dev/null 2>&1 || wlog "backend: 'open -a Docker' failed — start Docker yourself"
    return 0
  fi

  if ! msg="$(note_restarts "$name")"; then
    wlog "$name: $verdict — $msg"
    return 0
  fi

  wlog "$name: $verdict — starting"
  case "$name" in
    backend) start_detached backend "$REPO" docker compose up -d api redis ;;
    web)     start_detached web "$REPO/frontend-web" npm run dev ;;
    admin)   start_detached admin "$REPO/frontend-admin" npm run dev ;;
    mobile)  start_detached mobile "$REPO/mobile-app/reactnative" npm run web ;;
  esac
}

sweep_once() {
  local name
  for name in "${SERVICES[@]}"; do
    sweep_service "$name"
  done
}

# ---------------------------------------------------------------- modes ----

watchdog() {
  echo "$$" > "$WATCHDOG_PID"
  wlog "watchdog started (pid $$, repo $REPO, sweep every ${SWEEP_INTERVAL}s)"
  # Only delete OUR own pidfile. A SIGTERM is handled after the in-flight sleep,
  # which is up to SWEEP_INTERVAL late — and on 2026-11-19 that delay made an
  # exiting watchdog (96713) delete the pidfile its successor (98670) had already
  # claimed, so the next hook saw no watchdog and spawned a third.
  trap 'wlog "watchdog exiting (pid $$)"; [ "$(cat "$WATCHDOG_PID" 2>/dev/null)" = "$$" ] && rm -f "$WATCHDOG_PID"; exit 0' INT TERM
  while :; do
    sweep_once
    sleep "$SWEEP_INTERVAL"
  done
}

# daemon_pids — every watchdog WE started, found by its command line rather than
# by the pidfile. The pidfile can be missing (deleted by an exiting predecessor)
# or name a recycled pid; the live process is the only truth, and matching on it
# is also what keeps two watchdogs from ever sweeping the same free port at once.
daemon_pids() { pgrep -f "bash $SELF --daemon" 2>/dev/null; }
daemon_pid() { daemon_pids | head -1; }

status() {
  local name verdict running
  printf 'repo:  %s\nstate: %s\n\n' "$REPO" "$STATE_DIR"
  running="$(daemon_pid)"
  if [ -n "$running" ]; then
    printf 'watchdog: running (pid %s, sweeps every %ss)\n\n' "$running" "$SWEEP_INTERVAL"
  else
    printf 'watchdog: NOT running — nothing will re-start a service that dies\n\n'
  fi
  for name in "${SERVICES[@]}"; do
    verdict="$(probe_service "$name")"
    printf '%-8s %s' "$name" "$verdict"
    ours_alive "$name" && printf '  [started here: pid %s, log %s/%s.log]' "$(cat "$STATE_DIR/$name.pid")" "$STATE_DIR" "$name"
    printf '\n'
  done
}

# The hook entry point: no stdout (SessionStart stdout is injected as context),
# no waiting, safe to run from two sessions at once.
ensure_watchdog() {
  mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
  # A pidfile alone is not the truth: it can be missing (deleted by an exiting
  # predecessor) while a watchdog still runs. Two watchdogs must never sweep at
  # the same time — both would see one free port and both would start it.
  local running
  running="$(daemon_pid)"
  if [ -n "$running" ]; then
    # Re-claim the pidfile for the watchdog that is actually running, and leave a
    # line in the log: it is the only evidence, after the fact, that a Qoder
    # session actually ran this hook.
    [ "$(cat "$WATCHDOG_PID" 2>/dev/null)" = "$running" ] || echo "$running" > "$WATCHDOG_PID"
    wlog "hook: watchdog $running already running — nothing started"
    exit 0
  fi
  # No named daemon: whatever the pidfile says is stale (or a recycled pid).
  rm -f "$WATCHDOG_PID"
  # mkdir only succeeds for one racer, so two sessions cannot spawn two watchdogs.
  if ! mkdir "$SPAWN_LOCK" 2>/dev/null; then
    if [ "$(date +%s)" -lt $(( $(mtime_seconds "$SPAWN_LOCK") + 15 )) ]; then
      exit 0   # another hook is spawning right now
    fi
    rmdir "$SPAWN_LOCK" 2>/dev/null || exit 0
    mkdir "$SPAWN_LOCK" 2>/dev/null || exit 0
  fi
  ( nohup "$SELF" --daemon >> "$STATE_DIR/watchdog.log" 2>&1 & )
  rmdir "$SPAWN_LOCK" 2>/dev/null
  exit 0
}

mkdir -p "$STATE_DIR"

case "${1:-}" in
  --daemon)  watchdog ;;
  --once)    sweep_once ;;
  --status)  status ;;
  --stop)
    # Kill by command line, not by the pidfile: a pidfile can name a recycled
    # pid, and killing that would stop something unrelated to this repo. Every
    # named daemon is killed, so this also cleans up an accidental duplicate.
    stopped=""
    for wpid in $(daemon_pids); do
      kill "$wpid" 2>/dev/null && stopped="$stopped $wpid"
    done
    rm -f "$WATCHDOG_PID"
    if [ -n "$stopped" ]; then
      echo "watchdog stopped (pid$stopped; services and containers left running)"
    else
      echo "watchdog was not running"
    fi
    ;;
  "")        ensure_watchdog ;;
  *)         echo "usage: $(basename "$0") [--status|--once|--stop]" >&2; exit 64 ;;
esac
