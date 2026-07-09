#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dev-all.sh — launch the full Paymax × Spotlight dev stack in one terminal.
#
# Services (start order matters — later ones depend on earlier ones):
#   1. Go backend        :8091  backend/            (make run — loads backend/.env)
#   2. frontend-web      :3000  frontend-web/       (Next.js gateway; proxies
#                                                    /api/finance/* -> :8091)
#   3. frontend-admin    :3001  frontend-admin/     (admin console at /admin)
#   4. mobile (Expo web) :8083  mobile-app/reactnative
#
# Usage:
#   ./dev-all.sh                 # start everything
#   SKIP_BACKEND=1 ./dev-all.sh  # backend already running elsewhere
#   SKIP_MOBILE=1  ./dev-all.sh  # web stack only
#   (also: SKIP_WEB=1, SKIP_ADMIN=1)
#
# Ctrl-C stops the whole stack. Each service's logs are prefixed with a colored tag.
# No extra dependencies — plain bash + the tools each app already uses.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors (fall back to empty if not a terminal)
if [ -t 1 ]; then
  C_RESET="\033[0m"; C_BOLD="\033[1m"
  C_BE="\033[36m"; C_WEB="\033[32m"; C_ADMIN="\033[35m"; C_MOB="\033[33m"; C_ERR="\033[31m"
else
  C_RESET=""; C_BOLD=""; C_BE=""; C_WEB=""; C_ADMIN=""; C_MOB=""; C_ERR=""
fi

log() { printf "%b%s%b\n" "$C_BOLD" "$*" "$C_RESET"; }
err() { printf "%b%s%b\n" "$C_ERR" "$*" "$C_RESET" >&2; }

cleanup() {
  printf "\n%bShutting down dev stack…%b\n" "$C_BOLD" "$C_RESET"
  # Kill the whole process group so child go/node/expo processes die too.
  trap - EXIT INT TERM
  kill 0 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# run <label> <color> <relative-dir> <command...>
# Streams the command's output with a colored [label] prefix, line-buffered.
run() {
  local label="$1" color="$2" dir="$3"; shift 3
  local prefix; prefix="$(printf "%b[%s]%b" "$color" "$label" "$C_RESET")"
  if [ ! -d "$ROOT/$dir" ]; then
    err "  ! skipping $label — directory not found: $dir"
    return 0
  fi
  (
    cd "$ROOT/$dir" || exit 1
    "$@" 2>&1 | while IFS= read -r line; do printf "%s %s\n" "$prefix" "$line"; done
  ) &
}

# Best-effort: wait until the Go backend answers before starting the web gateway,
# so the /api/finance proxy has a live target. Times out after ~20s and proceeds.
wait_for_backend() {
  command -v curl >/dev/null 2>&1 || { sleep 3; return 0; }
  local i
  for i in $(seq 1 20); do
    if curl -sf -o /dev/null --max-time 1 http://localhost:8091/api/v1/public/health; then
      log "  ✓ backend healthy on :8091"
      return 0
    fi
    sleep 1
  done
  err "  ! backend health check timed out — starting web anyway (events/finance may 503 until it's up)"
}

# ── Prerequisite checks (warn only) ──────────────────────────────────────────
command -v go   >/dev/null 2>&1 || err "  ! 'go' not found on PATH — the backend won't start"
command -v node >/dev/null 2>&1 || err "  ! 'node' not found on PATH — the web/admin/mobile apps won't start"

log ""
log "Starting Paymax × Spotlight dev stack…"
log "  Admin        → http://localhost:3001/admin"
log "  Frontend web → http://localhost:3000"
log "  Mobile (web) → http://localhost:8083"
log "  Backend API  → http://localhost:8091"
log ""

# 1. Go backend
if [ "${SKIP_BACKEND:-0}" != "1" ]; then
  run "backend" "$C_BE" "backend" make run
  wait_for_backend
else
  log "  (skipping backend — SKIP_BACKEND=1)"
fi

# 2. frontend-web
if [ "${SKIP_WEB:-0}" != "1" ]; then
  run "web" "$C_WEB" "frontend-web" npm run dev
fi

# 3. frontend-admin
if [ "${SKIP_ADMIN:-0}" != "1" ]; then
  run "admin" "$C_ADMIN" "frontend-admin" npm run dev
fi

# 4. mobile (Expo web)
if [ "${SKIP_MOBILE:-0}" != "1" ]; then
  run "mobile" "$C_MOB" "mobile-app/reactnative" npm run web
fi

log ""
log "All services launched. Press Ctrl-C to stop everything."

# Keep the launcher alive until all background jobs exit (or Ctrl-C).
wait
