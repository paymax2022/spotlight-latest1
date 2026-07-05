#!/usr/bin/env bash
# ============================================================================
# Paymax × Spotlight — one-command local bring-up against the repo's Supabase.
#
# Installs the toolchain (Go, Supabase CLI) if missing, starts the LOCAL
# Supabase stack defined in supabase/config.toml, applies all migrations,
# builds the Go backend + both Next.js frontends, and launches the suite.
#
# REQUIREMENTS that this script cannot self-provision (it will check + tell you):
#   - Docker (Supabase's local stack — Postgres 17 + auth + storage + postgis —
#     runs in Docker; `supabase start` needs it).
#   - Outbound network to go.dev / proxy.golang.org / npm / ghcr (toolchain + deps).
#
# Usage:
#   bash scripts/bootstrap-deploy.sh            # full: deps + db + build + run
#   bash scripts/bootstrap-deploy.sh db         # just start supabase + migrate
#   bash scripts/bootstrap-deploy.sh build      # just build backend + frontends
#   bash scripts/bootstrap-deploy.sh run        # just run (assumes db + build done)
# ============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
STEP="${1:-all}"
say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop (mac/win) or docker-ce (linux), start it, then re-run."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and re-run."
}

install_go() {
  command -v go >/dev/null 2>&1 && { say "Go present: $(go version)"; return; }
  say "Installing Go toolchain"
  local ver="1.25.0" os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"; arch="$(uname -m)"
  case "$arch" in x86_64|amd64) arch=amd64;; arm64|aarch64) arch=arm64;; esac
  if command -v brew >/dev/null 2>&1; then brew install go && return; fi
  curl -fsSL "https://go.dev/dl/go${ver}.${os}-${arch}.tar.gz" -o /tmp/go.tgz \
    || die "Could not download Go (network/egress?). Install Go ${ver}+ manually and re-run."
  sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz
  export PATH="$PATH:/usr/local/go/bin"
  command -v go >/dev/null 2>&1 || die "Go install failed; add /usr/local/go/bin to PATH."
  say "Go installed: $(go version)"
}

install_supabase_cli() {
  command -v supabase >/dev/null 2>&1 && { say "Supabase CLI present: $(supabase --version)"; return; }
  say "Installing Supabase CLI"
  if command -v brew >/dev/null 2>&1; then brew install supabase/tap/supabase && return; fi
  if command -v npm  >/dev/null 2>&1; then npm i -g supabase --no-fund --no-audit && return; fi
  die "Install the Supabase CLI manually: https://supabase.com/docs/guides/cli"
}

# ---------------------------------------------------------------------------
do_db() {
  need_docker
  install_supabase_cli
  say "Starting local Supabase stack (supabase/config.toml: API :54321, DB :54322)"
  supabase start
  say "Applying ALL migrations + seeds (clean apply via db reset)"
  # db reset replays supabase/migrations/*.sql in order onto the local DB,
  # which already has the auth/storage schemas, roles and postgis extension.
  supabase db reset
  say "Local Postgres: postgresql://postgres:postgres@localhost:54322/postgres"
}

do_build() {
  install_go
  say "Backend: go build + vet"
  ( cd backend && go build ./... && go vet ./... )
  say "Frontend deps (npm ci) + builds"
  ( cd frontend-web   && npm ci --no-fund --no-audit && npm run build )
  ( cd frontend-admin && npm ci --no-fund --no-audit && npm run build )
  say "Backend tests (race) — needs DB up + RAILS_MODE=fake"
  ( cd backend && RAILS_MODE=fake DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres" go test ./... -race -count=1 ) || say "(some tests need live rails/data — review output)"
}

do_run() {
  say "Launching suite (Ctrl-C to stop all)"
  export DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"
  export RAILS_MODE="${RAILS_MODE:-fake}"
  ( cd backend && go run ./cmd/server ) &  BACK=$!
  ( cd frontend-web   && npm run start ) & WEB=$!
  ( cd frontend-admin && npm run start ) & ADMIN=$!   # serves http://localhost:3001/admin
  say "backend :8080 · web :3000 · admin :3001/admin · supabase studio :54323"
  trap 'kill $BACK $WEB $ADMIN 2>/dev/null || true' INT TERM
  wait
}

case "$STEP" in
  all)   do_db; do_build; do_run ;;
  db)    do_db ;;
  build) do_build ;;
  run)   do_run ;;
  *) die "unknown step '$STEP' (use: all | db | build | run)" ;;
esac
