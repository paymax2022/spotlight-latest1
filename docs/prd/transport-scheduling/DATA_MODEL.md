# Transport Scheduling — Data Model Reference

Human-readable companion to `SWARM_INTEGRATION_CONTRACT.md` (frozen source of truth).
Owned by the DB/Contract agent. Backend/Mobile/Admin/QA must treat the migration files
below as authoritative if this doc and the SQL ever disagree — the SQL wins.

## Migrations

1. `supabase/migrations/20260906000000_transport_scheduled_bookings.sql`
   - Extension guards: `pgcrypto`, `postgis` (idempotent `CREATE EXTENSION IF NOT EXISTS`).
   - Enum `scheduled_booking_status` (guarded via `DO $$ ... EXCEPTION WHEN duplicate_object`).
   - Table `transport_scheduled_bookings` (all columns/checks/indexes below).
   - RLS enabled: owner-scoped `SELECT`/`INSERT` for `authenticated`, full bypass for `service_role`.
2. `supabase/migrations/20260906000001_transport_scheduled_rbac.sql`
   - Seeds 3 permissions and grants them to existing mobility admin roles (see RBAC section).

Both migrations are additive-only: no `DROP`, no renames, no type narrowing. Safe to re-run
(`CREATE TABLE/INDEX IF NOT EXISTS`, enum guarded, `INSERT ... ON CONFLICT DO NOTHING`).

## Table: `transport_scheduled_bookings`

One row per user-scheduled future logistics movement. This table is a scheduling layer
**over** the existing transport module — it never duplicates trip/parcel/bus_ticket data;
it points at the materialized row once dispatched.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `market_id` | `text not null default 'NG'` | multi-market readiness |
| `user_id` | `uuid not null` | FK `auth.users(id)` |
| `mode` | `text not null` | check in `('ride_hail','ride_share','parcel_intra','parcel_inter','airport_pickup','bus')` |
| `status` | `scheduled_booking_status not null default 'scheduled'` | see FSM below |
| `scheduled_pickup_at` | `timestamptz not null` | |
| `lead_time_minutes` | `int not null default 30` | scheduler dispatch window before pickup |
| `timezone` | `text not null default 'Africa/Lagos'` | |
| `pickup_label` / `pickup_geo` | `text` / `geography(point,4326)` | |
| `dropoff_label` / `dropoff_geo` | `text` / `geography(point,4326)` | |
| `mode_payload` | `jsonb not null default '{}'` | ride: `pricing_mode`/`vehicle_class`; parcel: `dims`/`weight`/`inter_state`; airport: `flight_number`/`arrival_time`/`terminal`; bus: `schedule_id`/`seat_number` |
| `estimated_fare_kobo` | `bigint` | quote shown at booking time; NOT charged yet |
| `currency` | `text not null default 'NGN'` | |
| `payment_method` | `text not null default 'wallet'` | |
| `materialized_ref` | `text` | id of the Trip / parcel job / bus ticket once dispatched |
| `materialized_kind` | `text` | `'trip'` \| `'parcel'` \| `'bus_ticket'` |
| `settlement_id` | `text` | escrow settlement ref, set at dispatch |
| `dispatch_attempts` | `int not null default 0` | |
| `last_dispatch_error` | `text` | |
| `reminder_24h_sent_at` / `reminder_1h_sent_at` | `timestamptz` | |
| `idempotency_key` | `text not null unique` | required on create/cancel |
| `cancel_reason` | `text` | |
| `created_at` / `updated_at` | `timestamptz default now()` | |
| `dispatched_at` / `completed_at` / `cancelled_at` | `timestamptz` | terminal-state timestamps |

### Indexes
- `transport_scheduled_bookings_user_status_idx (user_id, status)` — member list endpoint.
- `transport_scheduled_bookings_status_pickup_idx (status, scheduled_pickup_at)` — scheduler scan.
- `transport_scheduled_bookings_pending_pickup_idx (scheduled_pickup_at) WHERE status = 'scheduled'` — partial index, scheduler hot path.
- `transport_scheduled_bookings_pickup_geo_gist USING GIST (pickup_geo)` — radius/map queries.

### Enum: `scheduled_booking_status`
`scheduled`, `dispatch_pending`, `dispatched`, `completed`, `cancelled`, `failed_no_driver`, `expired`.

## FSM (frozen — Backend implements as explicit guards, QA tests)

```
scheduled        --(scheduler: pickup_at - lead_time <= now)-->        dispatch_pending
dispatch_pending --(materialize via mode service + escrow OK)-->       dispatched
                     (sets materialized_ref, settlement_id, dispatched_at)
dispatch_pending --(no driver in fallback window / attempts exhausted)--> failed_no_driver
dispatched       --(underlying trip/parcel completes)-->               completed
scheduled | dispatch_pending --(user or admin cancel)-->               cancelled
                     (refund if already escrowed)
scheduled        --(pickup_at passed, no dispatch — safety net)-->     expired
```

Illegal transitions must return a typed `CodedError`. No implicit transitions.
**Invariant:** any booking that ever escrowed funds must reach a terminal state that
refunds or settles them — never strand an escrow.

## RBAC permissions seeded (exact strings — Backend/Admin agents must match)

- `transport.admin.scheduled.read`
- `transport.admin.scheduled.reassign`
- `transport.admin.scheduled.cancel`

Granted to (mirrors `20260621090000_mobility_rbac.sql` / `20260625130000_mobility_ops_roles.sql`):
- `super-admin` — all 3.
- `mobility-ops` — all 3.
- `dispatch-admin` — all 3.
- `logistics-admin` — read + reassign only (cancel/refund power withheld).
- `system-admin` — read only.

## API surface (appended to `contracts/openapi.yaml`)

Member (`/api/finance/mobility/scheduled`, auth, OLA to owner):
- `POST /mobility/scheduled` (Idempotency-Key)
- `GET /mobility/scheduled?filter=upcoming|past|all&cursor&limit`
- `POST /mobility/scheduled/estimate`
- `GET /mobility/scheduled/{id}`
- `PATCH /mobility/scheduled/{id}` (409 if status != scheduled)
- `POST /mobility/scheduled/{id}/cancel` (Idempotency-Key)

Admin (`/api/finance/admin/transport/scheduled`, `guard("transport.admin.scheduled.*")`,
every mutation requires `reason_code` and writes the transport audit log):
- `GET /admin/transport/scheduled?status=&mode=&from=&to=`
- `GET /admin/transport/scheduled/{id}`
- `POST /admin/transport/scheduled/{id}/force-dispatch` (Idempotency-Key, reason_code)
- `POST /admin/transport/scheduled/{id}/reassign` (Idempotency-Key, reason_code, driver_id)
- `POST /admin/transport/scheduled/{id}/cancel` (Idempotency-Key, reason_code)

Error shape: reuses the transport `MobilityError`/`CodedError` shape (`{code,message}` + HTTP status).
