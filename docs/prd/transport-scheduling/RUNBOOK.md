# Transport Trip Scheduling — Operations Runbook

Feature flag: `FEATURE_TRANSPORT_SCHEDULING_ENABLED` (off by default).
Scope: a scheduling layer OVER the existing `transport` module. Users schedule future
logistics movements (`ride_hail`, `ride_share`, `parcel_intra`, `parcel_inter`,
`airport_pickup`, `bus`). A worker materializes the real booking + escrows at lead time.

Owning code:
- Backend package: `backend/internal/transport/scheduled*.go`
- Worker: `backend/cmd/transport-scheduler/main.go`
- Routes: `backend/internal/app/finance_routes.go` (flag-gated `mob` + `adminTr` groups)
- Config: `backend/internal/config/config.go` (`FeatureTransportSchedulingEnabled`)
- Migrations: `supabase/migrations/20260906000000_transport_scheduled_bookings.sql`,
  `supabase/migrations/20260906000001_transport_scheduled_rbac.sql`

---

## 1. Migration apply order

Two additive-only migrations. Apply the table+enum FIRST, then RBAC (RBAC grants reference
nothing in the first file, but keep the numeric order for reproducibility):

```
supabase/migrations/20260906000000_transport_scheduled_bookings.sql   # enum + table + indexes + RLS
supabase/migrations/20260906000001_transport_scheduled_rbac.sql       # transport.admin.scheduled.* perms + role grants
```

Apply to the linked remote Supabase project:

```
supabase db push          # applies all pending tracked migrations in filename order
# or, local/CI mirror:
make migrate-up           # psql-applies every supabase/migrations/*.sql in sort order
```

Requirements: the target Postgres must have the `postgis` extension available
(`pickup_geo`/`dropoff_geo` are `geography(Point,4326)`; a GIST index is created on
`pickup_geo`). The migration runs `CREATE EXTENSION IF NOT EXISTS postgis;` — the DB role
must be allowed to create extensions (Supabase managed instances already have postgis).

Both files are idempotent (enum guarded via `DO $$ ... duplicate_object`, table/index via
`IF NOT EXISTS`, grants via `ON CONFLICT DO NOTHING`) — safe to re-run.

---

## 2. Running the scheduler worker

The worker is built from the SAME backend image ("build once, deploy many").

Local (Make):
```
make transport-scheduler-run      # FEATURE_TRANSPORT_SCHEDULING_ENABLED=true go run ./cmd/transport-scheduler
```

Docker Compose (profile-gated, mirrors the marketplace workers):
```
docker compose --profile transport-scheduling up -d transport-scheduler
docker compose --profile transport-scheduling logs -f transport-scheduler
docker compose --profile transport-scheduling stop transport-scheduler
```

The worker is gated twice: (1) the `transport-scheduling` compose profile means it never
starts unless explicitly requested, and (2) the binary reads
`FEATURE_TRANSPORT_SCHEDULING_ENABLED` and exits immediately if false.

Service construction (documented by the Backend agent, verified here):
`ledger.NewService(ledger.NewRepository(pool), nil)` → `settlement.NewService(pool, ledgerSvc)`
→ `transport.NewService(pool, settlementSvc)`. Redis is intentionally nil — idempotency is
keyed on the DB-unique `settlements`/`ledger` keys (same graceful-degradation contract as
`marketplace-cron`). Only `DATABASE_URL` is strictly required.

The worker runs three independent 60s `runLoop` goroutines (each isolated with a 5-minute
timeout + panic recovery):
- `dispatch-due` — selects `scheduled` bookings whose lead window has arrived and drives
  `Service.DispatchScheduled` per booking.
- `reminders` — `Service.SendDueReminders` (24h/1h; see §5).
- `expire-stale` — `Service.ExpireStale` safety-net for past-due, never-dispatched bookings.

---

## 3. Dispatch / lead-time / fallback behavior

- A booking is due for dispatch when `scheduled_pickup_at - lead_time_minutes*interval <= now()`.
  `lead_time_minutes` is stored per booking (default 30; per-mode defaults in
  `scheduled_dispatch.go`).
- On dispatch the worker flips `scheduled → dispatch_pending`, then calls the per-mode
  transport Service (`RequestRide` for ride/airport, `BookParcel` for parcel, the bus
  seat-booking path for bus) to materialize the real trip/parcel/bus_ticket, sets
  `materialized_ref`/`materialized_kind`, escrows via `settlement.Escrow(...)`, sets
  `settlement_id` + `dispatched_at`, and moves to `dispatched`.
- Dispatch is idempotent per booking (deterministic idempotency key `sched:<id>:dispatch`),
  so a re-tick or crash-restart never double-charges.
- Fallback: if no driver/courier is matched within the fallback window (or the mode service
  errors) and attempts are exhausted, the booking moves to `failed_no_driver`, the user is
  notified, and it surfaces on the admin ops board for manual `force-dispatch`/`reassign`.

FSM (terminal states in bold): `scheduled → dispatch_pending → dispatched → **completed**`;
`scheduled|dispatch_pending → **cancelled**` (refund if escrowed);
`dispatch_pending → **failed_no_driver**`; `scheduled → **expired**` (safety net). Illegal
transitions return a typed `CodedError`.

---

## 4. Escrow-at-dispatch + no-stranded-escrow reconciliation

- Money is NEVER moved at scheduling time. Escrow happens only at dispatch, via
  `settlement` (never ad-hoc ledger postings; balances are ledger projections).
- Invariant (enforced by the FSM + QA `escrow_safety_test.go`): a booking that EVER escrowed
  funds MUST reach a terminal state that refunds or settles them — never strand an escrow.
  `cancelled` refunds if already escrowed; `failed_no_driver` refunds before parking;
  `completed` settles on trip/parcel completion.
- Reconciliation note (do this before/after go-live and periodically in ops): for every
  booking with a non-null `settlement_id` in a NON-terminal state that has aged past its
  expected completion, confirm the underlying settlement is still `open`/escrowed and matches
  a live materialized artifact. Any `settlement_id` on a `cancelled`/`failed_no_driver`
  booking whose settlement is still open is a stranded escrow — investigate and refund. (A
  standalone reconciliation job like `marketplace-cron`'s hourly SUM-check is a recommended
  follow-up; see punch-list.)

---

## 5. Reminders (CURRENTLY LOG-ONLY — wiring TODO)

24h and 1h pre-pickup reminders are DB-idempotent (guarded by `reminder_24h_sent_at` /
`reminder_1h_sent_at`) but currently only LOG. No `notifications.Service` is wired into the
transport Service yet; there is a `TODO(notifications)` injection point in the reminders
path. This is an accepted P2 for the first cut but MUST be wired before users depend on
reminders. Because the send is DB-idempotent, wiring a real provider later will not
double-send for already-marked rows.

---

## 6. Feature-flag rollout + rollback

Rollout:
1. Apply both migrations (§1) to the target Postgres (additive — safe with the flag off).
2. Deploy backend with `FEATURE_TRANSPORT_SCHEDULING_ENABLED=false` (routes stay hidden,
   worker no-ops). Verify the deploy is healthy.
3. Bring up the `transport-scheduler` worker (compose profile / orchestrator) with the flag
   `true` when ready to activate; flip the API's flag to `true` to expose the routes.
4. Watch worker logs (`dispatch-due` / `reminders` / `expire-stale` counts) and the admin
   ops board (`failed_no_driver` aging).

Rollback:
- Set `FEATURE_TRANSPORT_SCHEDULING_ENABLED=false` and stop the `transport-scheduler`
  worker. Routes disappear and no new dispatch/escrow happens.
- Migrations are additive-only with NO down-migration by design (house rule). Leaving the
  `transport_scheduled_bookings` table in place is harmless when the flag is off.
- In-flight bookings already `dispatched` are ordinary trips/parcels/bus tickets from that
  point and settle through the normal transport flow. Before turning the flag off with
  bookings mid-flight, drain or admin-cancel (refunds) any `scheduled`/`dispatch_pending`
  rows so no escrow is stranded.

---

## 7. RBAC roles granted the new permissions

Seeded by `20260906000001_transport_scheduled_rbac.sql`. Perms (server-enforced via
`middleware.RequirePermission`; slugs must stay in sync with the constants in
`finance_routes.go`):

- `transport.admin.scheduled.read` — read-only ops board (list/get).
- `transport.admin.scheduled.reassign` — force-dispatch / reassign.
- `transport.admin.scheduled.cancel` — admin cancel + refund.

Role grants:
- `super-admin` — all three (never locked out).
- `mobility-ops` — all three (read + reassign + cancel).
- `dispatch-admin` — all three.
- `logistics-admin` — read + reassign only.
- `system-admin` — read only.
