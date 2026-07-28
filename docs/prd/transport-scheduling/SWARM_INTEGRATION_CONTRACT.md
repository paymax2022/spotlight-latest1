# TRANSPORT SCHEDULING SWARM — INTEGRATION CONTRACT (read first, obey exactly)

Feature: let users **schedule future logistics movements** across ride hailing, ride sharing,
parcel (intra + inter-state), and airport pickup, plus user-facing advance bus seat booking.
This is a **scheduling layer OVER the existing `transport` module** — reuse its per-mode
services; do NOT reimplement rides/parcel/bus.

House doctrine that OVERRIDES everything: repo-root `CLAUDE.md`. Money in kobo int64,
Idempotency-Key on money endpoints, additive-only migrations, double-entry ledger via
`settlement` (never store balances), OLA on every endpoint, immutable admin audit, feature flag.

## Product decisions (frozen)
- Modes: `ride_hail`, `ride_share`, `parcel_intra`, `parcel_inter`, `airport_pickup`, `bus`.
- **One-time** scheduling only (no recurrence this pass).
- **Auto-dispatch at lead time**: a scheduler worker materializes the real booking a
  configurable window (`lead_time_minutes`, default per-mode) before `scheduled_pickup_at`.
  Wallet is **charged/escrowed at dispatch** (not at booking). If no driver/courier is matched
  within the fallback window → `failed_no_driver`, notify user, surface on admin ops board.
- Reminders to the user at 24h and 1h before pickup (reuse existing notification path).
- Airport pickup carries optional `flight_number` + `arrival_time`; if `arrival_time` is set,
  `scheduled_pickup_at` is derived from it (+ buffer) and is adjustable. No live flight API
  integration this pass — accept/adjust arrival time manually; leave a clean hook.
- Bus "scheduling" = user books a seat on a future `bus_schedule` in advance and it appears in
  the unified scheduled list with reminders; the seat booking itself reuses existing bus flow.

## Existing transport internals to REUSE (verified — read before coding)
- Package `transport` (`backend/internal/transport/`), Gin. Service built in
  `backend/internal/app/finance_routes.go` (~L1281): `transport.NewService(pool, settlementSvc)`,
  `.WithMaps(...)`, `transport.NewHandler(svc)`, `transport.NewAdminHandler(NewAdminService(svc))`.
- Route groups (finance_routes.go): member `mob := finance.Group("/mobility")` →
  `/api/finance/mobility/*`; admin `adminTr := r.Group("/api/finance/admin/transport")`.
- Reuse these Service methods for materialization:
  - `RequestRide(ctx, riderID string, req RequestRideRequest, idempotencyKey string) (*tripDetail, error)` — ride_hail / ride_share / airport_pickup.
  - `BookParcel(ctx, senderID string, req ParcelBookRequest, idempotencyKey string) (map[string]any, error)` — parcel_intra / parcel_inter.
  - Bus booking: reuse the existing bus seat-booking service method (grep bus.go for the passenger booking func).
- Money: escrow at dispatch via `s.settlement.Escrow(ctx, userID, ref, idemKey, "transport", kobo)`;
  cancel/refund via `s.settlement.Refund(ctx, settlementID, reason)`. Never post ad-hoc ledger.
- Pricing/estimate: reuse existing `pricing.go` estimate path for the fare quote shown at booking.

---

## FROZEN DATA MODEL (Agent DB owns the migration)
New table `transport_scheduled_bookings` (+ enum `scheduled_booking_status`), additive migration
`supabase/migrations/2026090600000X_transport_scheduled_bookings.sql` (pick timestamps AFTER the
newest existing migration). Columns (all snake_case):
`id uuid pk, market_id text not null default 'NG', user_id uuid not null, mode text not null
(check in the 6 modes), status scheduled_booking_status not null default 'scheduled',
scheduled_pickup_at timestamptz not null, lead_time_minutes int not null default 30,
timezone text not null default 'Africa/Lagos',
pickup_label text, pickup_geo geography(point,4326), dropoff_label text, dropoff_geo geography(point,4326),
mode_payload jsonb not null default '{}'  -- ride: pricing_mode/vehicle_class; parcel: dims/weight/inter_state flag; airport: flight_number/arrival_time/terminal; bus: schedule_id/seat_number,
estimated_fare_kobo bigint, currency text not null default 'NGN',
payment_method text not null default 'wallet',
materialized_ref text,          -- id of the created Trip / parcel job / bus ticket once dispatched
materialized_kind text,          -- 'trip'|'parcel'|'bus_ticket'
settlement_id text,              -- escrow settlement ref (set at dispatch)
dispatch_attempts int not null default 0, last_dispatch_error text,
reminder_24h_sent_at timestamptz, reminder_1h_sent_at timestamptz,
idempotency_key text not null unique,
cancel_reason text, created_at timestamptz default now(), updated_at timestamptz default now(),
dispatched_at timestamptz, completed_at timestamptz, cancelled_at timestamptz`.
Indexes: `(user_id, status)`, `(status, scheduled_pickup_at)` (scheduler scan),
partial `(scheduled_pickup_at) where status='scheduled'`, GIST on pickup_geo.
`scheduled_booking_status` enum: `scheduled, dispatch_pending, dispatched, completed,
cancelled, failed_no_driver, expired`.
Also seed RBAC perms: `transport.admin.scheduled.read`, `transport.admin.scheduled.reassign`,
`transport.admin.scheduled.cancel` (match existing mobility RBAC seed pattern in
`supabase/migrations/20260621090000_mobility_rbac.sql`).

## FROZEN FSM (Agent Backend implements as explicit guards; Agent QA tests)
`scheduled` --(scheduler: pickup_at - lead_time ≤ now)--> `dispatch_pending`
`dispatch_pending` --(materialize via mode service + escrow OK)--> `dispatched` (set materialized_ref, settlement_id, dispatched_at)
`dispatch_pending` --(no driver within fallback window / mode error, attempts exhausted)--> `failed_no_driver`
`dispatched` --(underlying trip/parcel completes)--> `completed`
`scheduled|dispatch_pending` --(user or admin cancel)--> `cancelled` (refund if already escrowed)
`scheduled` --(pickup_at passed with no dispatch, safety net)--> `expired`
Illegal transitions return a typed CodedError (reuse transport `codedErr`). No implicit transitions.
Invariant: a booking that ever escrowed funds MUST reach a terminal state that refunds or settles
them — never strand an escrow.

## FROZEN HTTP ROUTES (Agent Backend registers under existing groups)
Member (`/api/finance/mobility/scheduled`, auth, OLA to owner):
- `POST /scheduled` (Idempotency-Key required) — body: `{mode, scheduled_pickup_at, lead_time_minutes?, pickup:{label,lat,lng}, dropoff:{label,lat,lng}, mode_payload{...}, payment_method?}` → 201 booking + `estimated_fare_kobo`.
- `GET /scheduled?filter=upcoming|past|all&cursor&limit` — list caller's bookings.
- `GET /scheduled/:id` — detail (OLA).
- `PATCH /scheduled/:id` — reschedule time / edit params; 409 if status != scheduled.
- `POST /scheduled/:id/cancel` (Idempotency-Key) — cancel; refund via settlement if escrowed.
- `POST /scheduled/estimate` — fare/ETA quote for a prospective booking (reuse pricing).
Admin (`/api/finance/admin/transport/scheduled`, `guard("transport.admin.scheduled.*")`, every
mutation writes transport audit with reason_code):
- `GET /scheduled?status=&mode=&from=&to=` — ops board (upcoming + failed_no_driver aging).
- `GET /scheduled/:id`.
- `POST /scheduled/:id/force-dispatch` (reason_code) — manual retry of materialization.
- `POST /scheduled/:id/reassign` (reason_code) — hand to a specific driver where applicable.
- `POST /scheduled/:id/cancel` (reason_code) — admin cancel + refund.
Error shape: reuse transport `CodedError` (`{code,message}` + HTTP status). Idempotency-Key on money POSTs.

## SCHEDULER WORKER (Agent Backend owns)
`backend/cmd/transport-scheduler/main.go` — runLoop (mirror `backend/cmd/marketplace-cron/main.go`
style): every 60s (a) find `scheduled` bookings due for dispatch (`scheduled_pickup_at -
lead_time_minutes*interval ≤ now()`), flip to `dispatch_pending`, call
`transport.Service.DispatchScheduled(ctx, bookingID)` which materializes + escrows + sets state;
(b) send due reminders (24h/1h); (c) expire safety-net past-due `scheduled`. Dispatch must be
idempotent per booking (deterministic idem key `sched:<id>:dispatch`). NEVER post ledger entries
directly — go through the transport Service which uses `settlement`. Expose
`transport.NewSchedulerService(...)` or reuse `transport.Service` — Backend agent decides but
documents the constructor in its report.

## FILE OWNERSHIP (do not write outside your boundary)
- **DB/Contract**: `supabase/migrations/*transport_scheduled*.sql` (table+enum+RBAC) + `contracts/openapi.yaml` (append scheduled paths) + `docs/prd/transport-scheduling/` reference docs.
- **Backend** (single owner of package `transport` changes to avoid collisions): new files ONLY
  `backend/internal/transport/scheduled.go`, `scheduled_fsm.go`, `scheduled_handler.go`,
  `scheduled_admin.go`, `scheduled_dispatch.go` (+ `scheduled_test.go` unit guards) + the
  registration edits inside `backend/internal/app/finance_routes.go` (add scheduled routes to the
  existing `mob` and `adminTr` groups — do not restructure the file) + `backend/cmd/transport-scheduler/main.go`.
  Do NOT modify existing transport files except to add a small exported hook if unavoidable (note it).
- **Mobile**: `mobile-app/reactnative/app/mobility/scheduled/**` + `mobile-app/reactnative/src/features/mobility/api/scheduled.api.ts` + a `hooks/useScheduled.ts`, reusing existing mobility components/patterns.
- **Admin**: `frontend-admin/app/admin/mobility/scheduled/**` + a scheduled admin service under the existing admin service lib, reusing the per-mode admin page patterns.
- **QA**: `backend/tests/transport_scheduled/**` (black-box, external test package, exported API only) + `tools/loadtest/transport_scheduled/*.js` + `docs/prd/transport-scheduling/QA_REPORT.md`.
- **DevOps/Verify**: `docker-compose.yml` (add transport-scheduler service, flag-gated), `Makefile` targets, env docs, `docs/prd/transport-scheduling/RUNBOOK.md`, and FINAL `go build`/`go vet` verification + surgical integration fixes.

Feature flag: `FEATURE_TRANSPORT_SCHEDULING_ENABLED` (reuse config pattern; off by default).
Do NOT run git checkout/commit/branch/stash. Stay in your boundary. Build must compile.
