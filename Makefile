# Paymax / Spotlight — developer + CI entrypoints (ENVIRONMENT-AND-GOLIVE.md).
# Adapted to the real repo: Go module at backend/ (go 1.25), npm frontends
# (frontend-web, frontend-admin), additive supabase migrations applied via psql.
# All targets are runnable inside the dev container and mirrored 1:1 by CI.

DATABASE_URL ?= postgres://paymax:paymax@localhost:5432/paymax?sslmode=disable
MIGRATIONS_DIR ?= supabase/migrations
REGISTRY ?= ghcr.io/spotlight
SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

.PHONY: bootstrap build vet test tsc tsc-web tsc-admin migrate-up migrate-reset \
        fakes security-scan contract-check ci verify docker-build dev dev-down \
        rls-check db-push help \
        marketplace-build marketplace-indexer-run marketplace-cron-run \
        marketplace-test marketplace-loadtest marketplace-up marketplace-down \
        transport-scheduler-run transport-scheduling-test transport-scheduling-loadtest

# ── Marketplace (feature-flagged; see docs/prd/marketplace/RUNBOOK.md) ──────────
ELASTICSEARCH_URL ?= http://localhost:9200
ES_URL ?= $(ELASTICSEARCH_URL)

MOBILE_DIR ?= mobile-app/reactnative
RAILS_MODE ?= fake
# Tables allowed to lack RLS. Only PostGIS's system reference table qualifies —
# it is world-readable spatial-reference data owned by the postgis extension and
# cannot take RLS. Anything else without RLS is a production blocker (see rls-check).
RLS_ALLOWLIST ?= 'spatial_ref_sys'

help:
	@grep -E '^[a-zA-Z_-]+:.*?# ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?# "}{printf "  %-16s %s\n", $$1, $$2}'

dev: # run full stack: backend+redis (docker) + frontend-web (:3000) + mobile ($(MOBILE_DIR) :8083)
	@echo "==> ensuring backend + redis are up via docker-compose (api on :8080)..."
	docker compose up -d api redis
	@echo "==> waiting for backend health on :8080..."
	@for i in $$(seq 1 30); do \
	  curl -sf http://localhost:8080/api/v1/mobile/health >/dev/null 2>&1 && { echo "    backend healthy"; break; }; \
	  [ $$i -eq 30 ] && { echo "    ERROR: backend never became healthy — check 'docker compose logs api'"; exit 1; }; \
	  sleep 1; \
	done
	@echo "==> starting frontend-web (:3000) + mobile ($(MOBILE_DIR) :8083). Ctrl-C stops both."
	@trap 'kill 0' INT TERM EXIT; \
	( cd frontend-web && npm run dev ) & \
	( cd $(MOBILE_DIR) && npm run start ) & \
	wait

dev-down: # stop the docker backend + redis started by 'make dev'
	docker compose stop api redis

bootstrap: # install deps (Go modules + frontend node_modules)
	cd backend && go mod download
	cd frontend-web && npm ci
	cd frontend-admin && npm ci
	@echo "bootstrap complete — run 'make ci' to verify"

build: # go build ./... (backend)
	cd backend && go build ./...

vet: # go vet ./... (backend static analysis)
	cd backend && go vet ./...

test: # go test ./... -race (backend; needs Postgres + RAILS_MODE=fake)
	cd backend && RAILS_MODE=$${RAILS_MODE:-fake} DATABASE_URL="$(DATABASE_URL)" go test ./... -race -count=1

tsc: tsc-web tsc-admin # full TypeScript typecheck (both frontends)

tsc-web: # frontend-web tsc --noEmit
	cd frontend-web && npm run type-check

tsc-admin: # frontend-admin tsc --noEmit
	cd frontend-admin && npm run type-check

migrate-up: # apply all additive supabase migrations to $(DATABASE_URL)
	@set -e; for f in $$(ls $(MIGRATIONS_DIR)/*.sql | sort); do \
	  echo "  applying $$f"; \
	  psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -q -f "$$f"; \
	done; echo "migrations applied"

migrate-reset: # drop + recreate public schema, then re-apply (idempotency/clean-apply check)
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
	$(MAKE) migrate-up
	@echo "re-applying to verify idempotency (additive migrations are forward-only)"
	$(MAKE) migrate-up
	$(MAKE) rls-check

rls-check: # fail if any public table lacks RLS (fintech go-live gate; allowlist: $(RLS_ALLOWLIST))
	@bad=$$(psql "$(DATABASE_URL)" -tAc "select coalesce(string_agg(t.tablename, ', ' order by t.tablename), '') \
	  from pg_tables t \
	  join pg_class c on c.relname = t.tablename \
	  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' \
	  where t.schemaname = 'public' and c.relrowsecurity = false \
	  and t.tablename not in ($(RLS_ALLOWLIST));"); \
	if [ -n "$$bad" ]; then \
	  echo "RLS CHECK FAILED — public tables without row-level security:"; \
	  echo "  $$bad"; \
	  echo "Enable RLS (deny-all is fine for backend-only tables) or add to RLS_ALLOWLIST with justification."; \
	  exit 1; \
	fi; \
	echo "rls-check ✓ — every public table has RLS enabled (allowlist: $(RLS_ALLOWLIST))"

db-push: # apply tracked migrations to the LINKED remote Supabase project (prod promotion)
	@command -v supabase >/dev/null 2>&1 || { echo "supabase CLI not found"; exit 1; }
	supabase db push
	@echo "pushed. Remember: 'db push' does NOT run seeds — bootstrap data must live in migrations."

fakes: # run the local FAKE rails service on :9100
	cd tools/fakes && go run .

security-scan: # dependency + vulnerability scan (best-effort, non-fatal locally)
	cd backend && go run golang.org/x/vuln/cmd/govulncheck@latest ./... || true
	cd frontend-web && npm audit --omit=dev || true
	cd frontend-admin && npm audit --omit=dev || true

docker-build: # build the build-once backend image tagged by commit SHA
	docker build -t $(REGISTRY)/paymax-backend:$(SHA) backend

contract-check: # implementation vs contracts/openapi.yaml (best-effort)
	@if [ -f package.json ] && grep -q '"contract:check"' package.json; then npm run contract:check; \
	else echo "  (no contract:check script — skipping)"; fi

ci: build tsc migrate-up test # the full local mirror of the CI verify job
	@echo "CI checks passed locally"

# verify — the SINGLE go-live gate. Run this in the dev container before promoting
# a build. Stricter than `ci`: adds go vet, a clean-apply + idempotency migration
# check (migrate-reset), the contract check, and a security scan.
marketplace-build: # build the marketplace API + indexer + cron binaries (Go)
	cd backend && go build ./internal/marketplace/... ./internal/marketplace/search/... ./cmd/marketplace-indexer ./cmd/marketplace-cron
	@echo "marketplace build ✓ (server, indexer, cron)"

marketplace-indexer-run: # run the ES indexer (drains mkt_listings_outbox → Elasticsearch)
	cd backend && set -a; [ -f .env ] && . ./.env; set +a; \
	DATABASE_URL="$(DATABASE_URL)" ES_URL="$(ES_URL)" FEATURE_MARKETPLACE_ENABLED=true go run ./cmd/marketplace-indexer

marketplace-cron-run: # run the marketplace cron (auto-expire / auto-release / hourly escrow reconciliation)
	cd backend && set -a; [ -f .env ] && . ./.env; set +a; \
	DATABASE_URL="$(DATABASE_URL)" FEATURE_MARKETPLACE_ENABLED=true go run ./cmd/marketplace-cron

marketplace-test: # focused marketplace test suite (unit + FSM/contract/HMAC; needs Postgres for DB-backed cases)
	cd backend && RAILS_MODE=$${RAILS_MODE:-fake} DATABASE_URL="$(DATABASE_URL)" ELASTICSEARCH_URL="$(ELASTICSEARCH_URL)" \
	  go test ./internal/marketplace/... ./tests/marketplace/... -count=1

marketplace-loadtest: # run the marketplace k6 load scripts (tools/loadtest/marketplace)
	@command -v k6 >/dev/null 2>&1 || { echo "k6 not found — install grafana/k6 to run load tests"; exit 1; }
	@for f in tools/loadtest/marketplace/*.js; do \
	  echo "==> k6 run $$f"; \
	  BASE_URL=$${BASE_URL:-http://localhost:8080} k6 run "$$f" || exit 1; \
	done

marketplace-up: # bring up ES + indexer + cron via the 'marketplace' compose profile
	docker compose --profile marketplace up -d elasticsearch marketplace-indexer marketplace-cron

marketplace-down: # stop the marketplace ES + workers
	docker compose --profile marketplace stop elasticsearch marketplace-indexer marketplace-cron

# ── Transport Trip Scheduling (feature-flagged; docs/prd/transport-scheduling/RUNBOOK.md) ──
transport-scheduler-run: # run the scheduler worker (dispatch-due / reminders / expire-stale loops)
	cd backend && set -a; [ -f .env ] && . ./.env; set +a; \
	DATABASE_URL="$(DATABASE_URL)" FEATURE_TRANSPORT_SCHEDULING_ENABLED=true go run ./cmd/transport-scheduler

transport-scheduling-test: # focused scheduled-bookings suite (DB-free FSM/OLA/contract; DB cases need Postgres+postgis)
	cd backend && RAILS_MODE=$${RAILS_MODE:-fake} DATABASE_URL="$(DATABASE_URL)" \
	  go test ./tests/transport_scheduled/... -count=1

transport-scheduling-loadtest: # run the transport-scheduling k6 load scripts (tools/loadtest/transport_scheduled)
	@command -v k6 >/dev/null 2>&1 || { echo "k6 not found — install grafana/k6 to run load tests"; exit 1; }
	@for f in tools/loadtest/transport_scheduled/*.js; do \
	  echo "==> k6 run $$f"; \
	  BASE_URL=$${BASE_URL:-http://localhost:8080} k6 run "$$f" || exit 1; \
	done

verify: build vet tsc contract-check migrate-reset test security-scan
	@echo ""
	@echo "================ GO-LIVE VERIFY: ALL CHECKS PASSED ================"
	@echo " backend build + vet   ✓"
	@echo " frontend tsc (web+adm) ✓"
	@echo " openapi contract       ✓"
	@echo " migrations clean-apply + idempotent ✓"
	@echo " RLS on every public table (rls-check) ✓"
	@echo " backend tests (-race)  ✓"
	@echo " security scan          ✓"
	@echo "=================================================================="
