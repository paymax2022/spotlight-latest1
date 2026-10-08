#!/usr/bin/env bash
# Brings up the full local integration stack:
#   Supabase (Postgres/GoTrue/REST/Inbucket) + Redis + fakes + backend + worker + frontend
# Requires: docker, node/npm (npx supabase), go.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

REDIS_PORT="${REDIS_PORT:-6380}"
SUPABASE_DB_PORT="${SUPABASE_DB_PORT:-54322}"

echo "== supabase local stack =="
if ! docker ps --filter "name=supabase_db_spotlight" --format '{{.Names}}' | grep -q .; then
  (cd supabase && npx --yes supabase start)
else
  echo "  already running"
fi

echo "== redis (:${REDIS_PORT}) =="
if ! docker ps --filter "name=spotlight-redis-integ" --format '{{.Names}}' | grep -q .; then
  docker run -d --name spotlight-redis-integ -p "${REDIS_PORT}:6379" redis:7-alpine >/dev/null
fi

echo "== migrations =="
docker exec supabase_db_spotlight psql -U postgres -d postgres -c \
  "SELECT count(*) FROM supabase_migrations.schema_migrations" >/dev/null
echo "  ok"

echo "== fakes provider (:9100) =="
if ! curl -sf -m 2 http://localhost:9100/health >/dev/null 2>&1; then
  (cd tools/fakes && RAILS_MODE=fake CALLBACK_BASE_URL=http://localhost:8080/internal/webhooks/academy \
    nohup go run . > /tmp/fakes.log 2>&1 &)
fi

echo "== env files =="
./tools/loadtest/integration/write-env.sh

echo "== backend (:8080) =="
if ! curl -sf -m 2 http://localhost:8080/api/v1/public/health >/dev/null 2>&1; then
  (cd backend && go build -o /tmp/paymax-api ./cmd/api)
  set -a; . ./backend/.env; set +a
  (nohup /tmp/paymax-api > /tmp/paymax-api.log 2>&1 &)
fi
for i in $(seq 1 60); do
  curl -sf -m 2 http://localhost:8080/readyz >/dev/null && break
  sleep 1
done

echo "== asynq worker =="
if ! pgrep -f paymax-worker >/dev/null 2>&1; then
  (cd backend && go build -o /tmp/paymax-worker ./cmd/worker)
  set -a; . ./backend/.env; set +a
  (nohup /tmp/paymax-worker > /tmp/paymax-worker.log 2>&1 &)
fi

echo "== frontend (:3000) =="
if ! curl -sf -m 2 http://localhost:3000 >/dev/null 2>&1; then
  (cd frontend-web && npm install --no-audit --no-fund >/dev/null && \
    nohup npm run dev > /tmp/frontend.log 2>&1 &)
fi

echo "== fixtures =="
./scripts/dev/ensure-dev-login.sh || true

echo ""
echo "stack up: frontend :3000  api :8080  supabase :54321  db :${SUPABASE_DB_PORT}  redis :${REDIS_PORT}  fakes :9100  mailpit :54324"
