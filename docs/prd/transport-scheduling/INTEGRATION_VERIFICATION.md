# Transport Trip Scheduling — Final Integration Verification

Branch: `feat/transport-scheduling`. Agent: DevOps + Final Integration Verification (last pass).
Date: 2026-07-04.

This pass wired infra, added one optional admin UI fix, and proved the feature compiles /
vets / passes its DB-free tests. Below is exactly what was done and the REAL command results.

---

## 1. Infra wired (DevOps)

| Area | Change | File |
|---|---|---|
| Docker image | Added `transport-scheduler` binary to the multi-stage build (built from the same image; "build once, deploy many") | `backend/Dockerfile` |
| Compose | Added `transport-scheduler` service — profile `transport-scheduling`, `command: /app/transport-scheduler`, `FEATURE_TRANSPORT_SCHEDULING_ENABLED=true` + `DATABASE_URL` + `REDIS_URL`, `depends_on redis (healthy)`. Mirrors `marketplace-cron`. Existing services untouched. | `docker-compose.yml` |
| Makefile | Added `transport-scheduler-run`, `transport-scheduling-test`, `transport-scheduling-loadtest` + `.PHONY` entries. Mirror the marketplace target style. | `Makefile` |
| Env docs | Appended `FEATURE_TRANSPORT_SCHEDULING_ENABLED=false` + lead-time defaults note + the reminders `TODO(notifications)` note. | `backend/.env.example` |
| Runbook | Created: migration order, worker run, dispatch/lead-time/fallback, escrow-at-dispatch + no-stranded-escrow reconciliation, reminders (log-only), flag rollout/rollback, RBAC roles. | `docs/prd/transport-scheduling/RUNBOOK.md` |

Compose sanity: `docker` is not installed in the verification workspace, so the compose file
was validated by YAML parse instead — parses cleanly; all 6 services present
(`api, redis, elasticsearch, marketplace-indexer, marketplace-cron, transport-scheduler`);
the new service's `profiles`, `command`, and env flag are correct.
Makefile `make -n` dry-run of the new targets expands correctly.

## 2. Optional admin fix (MobilityTabs)

DONE. Added `{ href: '/admin/mobility/scheduled', label: 'Scheduled', key: 'scheduled' }`
as a one-line additive entry in `MobilityTabs` in
`frontend-admin/app/admin/mobility/_ui.tsx`, following the existing 14-tab pattern exactly.
The target route directory `frontend-admin/app/admin/mobility/scheduled/` already exists
(`page.tsx`, `[id]/`, `_perms.ts`), so the link is valid. Other tabs untouched.

---

## 3. Build / vet / test results (REAL output)

Toolchain: portable Go 1.25.0 linux/amd64 (`/tmp/go125`), `GOFLAGS=-buildvcs=false`,
`GOCACHE=/tmp/gocache`, `GOMODCACHE=/tmp/gomod`.

### Backend build — PASS (exit 0)
```
go build ./internal/transport/... ./cmd/transport-scheduler/... ./internal/app/... ./internal/config/...
→ exit 0  (no output)
go build -o /tmp/tsbin ./cmd/transport-scheduler
→ scheduler binary OK
```
`./internal/app/...` includes the flag-gated route registration in `finance_routes.go`
and the worker's Service-construction dependencies — all compile.

### QA test compile — PASS (exit 0)
```
go build ./tests/transport_scheduled/...  → exit 0
```

### go vet — PASS (exit 0, no findings)
```
go vet ./internal/transport/... ./cmd/transport-scheduler/... ./tests/transport_scheduled/...
→ exit 0  (no output)
```

### DB-free tests — PASS
```
go test ./tests/transport_scheduled/...            → ok  (all pass)
go test ./internal/transport/... -run Scheduled|FSM  → ok  0.010s
```
Passing suites (external black-box package): OLA owner/non-owner access, admin-mutation
reason-code requirement, JSON contract field names, create-validation (missing
Idempotency-Key / invalid mode / bad RFC3339 / past pickup / negative lead time / guard
order), dispatch-window boundary + per-mode lead-time defaults, expire-stale grace period,
and escrow-safety (failed_no_driver always refunds before terminal; retry-before-exhaustion
returns to scheduled; dispatched never strands until completed; cancel-from-scheduled never
escrowed). The `live_db_integration_test.go` cases are properly gated and did NOT fail
without a database.

---

## 4. RBAC slug reconciliation — MATCH ✓

Cross-checked the migration's seeded permission slugs against the Go guard constants and the
route wiring:

| Slug (migration `20260906000001`) | Go constant (`finance_routes.go` L2309-2311) | Route usage |
|---|---|---|
| `transport.admin.scheduled.read` | `schedReadPerm` | `GET /scheduled`, `GET /scheduled/:id` |
| `transport.admin.scheduled.reassign` | `schedReassignPerm` | `POST /scheduled/:id/force-dispatch`, `.../reassign` |
| `transport.admin.scheduled.cancel` | `schedCancelPerm` | `POST /scheduled/:id/cancel` |

All three slugs match exactly across the migration `permissions` inserts, the Go constants,
and `middleware.RequirePermission(rbac, ...)` at the routes. No reconciliation needed.
Role grants seeded: super-admin / mobility-ops / dispatch-admin (all three),
logistics-admin (read+reassign), system-admin (read only).

## 5. Migration sanity

Both files are the newest in `supabase/migrations/` (after `20260905000001_marketplace_*`),
additive-only, and idempotent (enum via `DO $$ ... duplicate_object`; table/indexes via
`IF NOT EXISTS`; grants via `ON CONFLICT DO NOTHING`). No obvious SQL errors. Requires
`postgis` (declared via `CREATE EXTENSION IF NOT EXISTS`) for the geography columns + GIST
index. Enum values match the Go FSM exactly. RLS enabled with owner-scoped + service-role
policies.

---

## 6. What compiles here vs. what needs live infra

COMPILES + verified in this pass (no external services): backend build, worker binary,
QA test compile, go vet, and every DB-free unit/black-box test.

NEEDS live infra (NOT exercised here): anything touching a real Postgres+postgis — the
`live_db_integration_test.go` cases, actual dispatch/escrow, RLS behavior, and migration
apply. Docker/compose bring-up (docker not present in this workspace; YAML validated only).
Full-repo frontend typecheck (scoped single-file tsc reports only tsconfig-context artifacts,
not real errors in the additive change).

---

## 7. Prioritized production punch-list

1. **Apply both migrations to live Postgres+postgis** (`supabase db push`), confirm postgis
   is enabled and the GIST index builds. (P0 — required to run at all.)
2. **Run the full test suite against a live DB** (`make transport-scheduling-test` with a real
   `DATABASE_URL`, plus `go test ./... -race`) to exercise the gated `live_db_integration`
   cases and end-to-end dispatch/escrow. (P0)
3. **Wire a real `notifications.Service` into the transport reminders path** at the
   `TODO(notifications)` injection point. Reminders are currently log-only (DB-idempotent, so
   wiring later won't double-send). (P1 — users can't rely on 24h/1h reminders until then.)
4. **Turn the flag on in stages**: deploy with `FEATURE_TRANSPORT_SCHEDULING_ENABLED=false`,
   verify health, then bring up the `transport-scheduler` worker
   (`docker compose --profile transport-scheduling up -d transport-scheduler`) and flip the
   API flag to `true`. (P0 at go-live)
5. **Add a periodic escrow-reconciliation job** (mirror `marketplace-cron`'s hourly
   SUM-invariant check) to assert no stranded escrow on `cancelled`/`failed_no_driver`
   bookings. The FSM + tests enforce the invariant per-transition; a standing reconciliation
   is defense-in-depth. (P1)
6. **Wire the maps provider into the worker** if scheduled dispatch fares must match live
   routing exactly (the worker currently uses MockMaps for fare computation at dispatch). (P2)
7. **Full-repo `make tsc-admin` / `make tsc-web`** to confirm the admin tab + scheduled pages
   typecheck against the real project config in CI. (P2)
8. **No live flight API** for airport pickups this pass — arrival time is manual; a clean hook
   is left for later integration. (P3 — documented product decision)
