-- ── Paymax Mobility — Transport Trip Scheduling: transport_scheduled_bookings ──
-- ADDITIVE-ONLY: CREATE TYPE/TABLE/INDEX guarded to be idempotent (DO $$ blocks
-- for the enum, IF NOT EXISTS for table/indexes). NO DROP TABLE/COLUMN/TYPE, NO
-- RENAME, NO type narrowing, NO SET NOT NULL on a populated column. Safe to
-- re-run (matches house convention — see 20260824000000_arena_core.sql and
-- 20260905000000_marketplace_v1.sql).
--
-- Scope: this is a SCHEDULING LAYER over the existing `transport` module
-- (see docs/prd/transport-scheduling/SWARM_INTEGRATION_CONTRACT.md — frozen
-- data model). It does NOT reimplement rides/parcel/bus; a scheduler worker
-- materializes the real booking (trip / parcel job / bus ticket) at dispatch
-- time via the existing transport.Service, escrowing funds through
-- `settlement` at that point (never at scheduling time, never ad-hoc ledger
-- postings). Money fields are BIGINT kobo. market_id TEXT NOT NULL DEFAULT
-- 'NG' per house multi-market convention (mirrors marketplace_v1 / arena_core).

-- ─── Extension guards (idempotent; postgis needed for pickup_geo/dropoff_geo) ──
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════════
-- ENUM — mirrors the Go FSM in backend/internal/transport (scheduled.go /
-- scheduled_fsm.go) exactly. Postgres has no `CREATE TYPE IF NOT EXISTS`; guard
-- via DO $$ + catalog check so this migration is safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE scheduled_booking_status AS ENUM (
    'scheduled','dispatch_pending','dispatched','completed',
    'cancelled','failed_no_driver','expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- transport_scheduled_bookings — one row per user-scheduled future logistics
-- movement (ride_hail / ride_share / parcel_intra / parcel_inter /
-- airport_pickup / bus). The scheduler worker (backend/cmd/transport-scheduler)
-- flips status per the frozen FSM and, at dispatch, materializes the real
-- trip/parcel/bus_ticket row (materialized_ref/materialized_kind) and escrows
-- via `settlement` (settlement_id). This table NEVER stores a wallet balance
-- and NEVER posts ledger entries directly.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS transport_scheduled_bookings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id             TEXT NOT NULL DEFAULT 'NG',
    user_id               UUID NOT NULL REFERENCES auth.users(id),
    mode                  TEXT NOT NULL
                              CHECK (mode IN ('ride_hail','ride_share','parcel_intra',
                                              'parcel_inter','airport_pickup','bus')),
    status                scheduled_booking_status NOT NULL DEFAULT 'scheduled',
    scheduled_pickup_at   TIMESTAMPTZ NOT NULL,
    lead_time_minutes     INTEGER NOT NULL DEFAULT 30,
    timezone              TEXT NOT NULL DEFAULT 'Africa/Lagos',
    pickup_label          TEXT,
    pickup_geo            geography(Point,4326),
    dropoff_label         TEXT,
    dropoff_geo           geography(Point,4326),
    -- mode_payload carries mode-specific fields (config/schema-driven, not
    -- branching columns): ride -> pricing_mode/vehicle_class; parcel ->
    -- dims/weight/inter_state flag; airport -> flight_number/arrival_time/
    -- terminal; bus -> schedule_id/seat_number.
    mode_payload          JSONB NOT NULL DEFAULT '{}',
    estimated_fare_kobo   BIGINT,
    currency              TEXT NOT NULL DEFAULT 'NGN',
    payment_method        TEXT NOT NULL DEFAULT 'wallet',
    materialized_ref      TEXT,   -- id of the created Trip / parcel job / bus ticket once dispatched
    materialized_kind     TEXT,   -- 'trip' | 'parcel' | 'bus_ticket'
    settlement_id         TEXT,   -- escrow settlement ref (set at dispatch)
    dispatch_attempts     INTEGER NOT NULL DEFAULT 0,
    last_dispatch_error   TEXT,
    reminder_24h_sent_at  TIMESTAMPTZ,
    reminder_1h_sent_at   TIMESTAMPTZ,
    idempotency_key       TEXT NOT NULL UNIQUE,
    cancel_reason         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at         TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────
-- Caller's own bookings, filtered by status (member list endpoint).
CREATE INDEX IF NOT EXISTS transport_scheduled_bookings_user_status_idx
    ON transport_scheduled_bookings(user_id, status);

-- Scheduler scan: due-for-dispatch / reminder sweeps order by pickup time
-- within a status.
CREATE INDEX IF NOT EXISTS transport_scheduled_bookings_status_pickup_idx
    ON transport_scheduled_bookings(status, scheduled_pickup_at);

-- Partial index: the scheduler's hot-path query only ever looks at rows still
-- in 'scheduled' status when deciding what's due for dispatch/expiry — keep
-- that scan index small.
CREATE INDEX IF NOT EXISTS transport_scheduled_bookings_pending_pickup_idx
    ON transport_scheduled_bookings(scheduled_pickup_at)
    WHERE status = 'scheduled';

-- GIST for pickup_geo (radius / mapping queries), mirrors drivers_geog_gist in
-- 20260710000000_transport_dispatch_geo_and_shares.sql.
CREATE INDEX IF NOT EXISTS transport_scheduled_bookings_pickup_geo_gist
    ON transport_scheduled_bookings USING GIST (pickup_geo);

-- ─── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE transport_scheduled_bookings ENABLE ROW LEVEL SECURITY;

-- Owner-scoped read/insert, matching the pattern used for parcels/bus_tickets/
-- towing_jobs etc. in 20260624000000_transport_modes.sql. All writes in
-- practice go through the Go backend on the service-role connection; these
-- policies exist so authenticated Supabase-JS reads (if ever used) stay
-- owner-scoped by default.
CREATE POLICY "transport_scheduled_bookings_own" ON transport_scheduled_bookings
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
CREATE POLICY "transport_scheduled_bookings_insert" ON transport_scheduled_bookings
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Service role bypasses RLS (Go backend uses pgx/service role) — required for
-- the scheduler worker and admin control plane.
CREATE POLICY "transport_scheduled_bookings_service" ON transport_scheduled_bookings
    TO service_role USING (TRUE) WITH CHECK (TRUE);
