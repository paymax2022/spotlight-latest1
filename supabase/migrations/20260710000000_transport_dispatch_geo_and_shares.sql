-- Paymax Mobility — driver dispatch geo + crash-safety marker + share tokens.
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing.
--
-- Follow-up to 20260623000000_transport_mobility.sql. Adds:
--   (a) a PostGIS geography column on drivers so the dispatcher can do a real
--       radius search (ST_DWithin) on a GiST index instead of a bounding-box
--       scan of current_lat/current_lng. PostGIS is enabled by
--       20260626000000_enable_postgis.sql.
--   (b) trips.settlement_status — the durable crash-safety marker the backend
--       best-effort sets to 'settlement_pending' before it posts the ledger
--       split, so a crash mid-settlement is recoverable/auditable.
--   (c) trip_shares — a dedicated, revocable token table for live-share links
--       (was persisted ad-hoc via trip_events). token is the PK the public
--       GET /api/finance/mobility/public/track/:token resolves.
--
-- Additive-safety note on mode idempotency: parcels / bus_tickets / towing_jobs /
-- mover_jobs / car_hire_bookings / business_deliveries / event_transport_bookings
-- already carry `idempotency_key TEXT UNIQUE` (nullable) from
-- 20260624000000_transport_modes.sql and 20260625000500_transport_logistics_event.sql.
-- We deliberately do NOT force those columns NOT NULL here: pre-existing rows may
-- hold NULLs, and NULLs are exempt from UNIQUE, so a NOT NULL flip would be a
-- non-additive, potentially data-breaking narrowing. The existing UNIQUE guard is
-- sufficient for idempotent replay protection; leaving it as-is preserves
-- additive-safety.

-- ─── (a) drivers.geog: PostGIS geography for radius dispatch ──────────────────
-- geography(Point,4326) = lat/lng on the WGS84 spheroid; ST_DWithin(geog, p, m)
-- gives true metre-accurate "drivers within N metres" without a maps API.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS geog geography(Point,4326);

-- Keep geog in sync with current_lng/current_lat on every insert/update. A trigger
-- (not a generated column) is used because a GENERATED column may not be supported
-- for a geography expression across all PostGIS/PG builds, and a trigger is the
-- portable, additive-safe choice. NULL when either coordinate is missing.
CREATE OR REPLACE FUNCTION drivers_sync_geog() RETURNS trigger AS $$
BEGIN
    IF NEW.current_lng IS NOT NULL AND NEW.current_lat IS NOT NULL THEN
        NEW.geog := ST_SetSRID(ST_MakePoint(NEW.current_lng, NEW.current_lat), 4326)::geography;
    ELSE
        NEW.geog := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS drivers_sync_geog_trg ON drivers;
CREATE TRIGGER drivers_sync_geog_trg
    BEFORE INSERT OR UPDATE OF current_lng, current_lat ON drivers
    FOR EACH ROW EXECUTE FUNCTION drivers_sync_geog();

-- Backfill geog for existing rows that already have coordinates.
UPDATE drivers
   SET geog = ST_SetSRID(ST_MakePoint(current_lng, current_lat), 4326)::geography
 WHERE current_lng IS NOT NULL
   AND current_lat IS NOT NULL
   AND geog IS NULL;

-- GiST index powers the dispatcher's radius query. Intended backend usage
-- (NearbyDrivers rewrite):
--   SELECT ... FROM drivers
--    WHERE status = 'online'
--      AND geog IS NOT NULL
--      AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, $radius_m)
--    ORDER BY ST_Distance(geog, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography);
CREATE INDEX IF NOT EXISTS drivers_geog_gist ON drivers USING GIST (geog);

-- ─── (b) trips.settlement_status: durable crash-safety marker ─────────────────
-- Default 'settled' so every existing row is treated as already-settled (they are);
-- the backend flips a trip to 'settlement_pending' immediately before posting the
-- ledger split and back to 'settled' once the split commits. A sweeper can then
-- find trips stuck in 'settlement_pending' after a crash.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'settled'
    CHECK (settlement_status IN ('settled','settlement_pending','settlement_failed'));
CREATE INDEX IF NOT EXISTS trips_settlement_status_idx
    ON trips(settlement_status) WHERE settlement_status <> 'settled';

-- ─── (c) trip_shares: revocable live-share tokens ─────────────────────────────
-- The public track endpoint resolves the token here, checks revoked_at IS NULL and
-- expires_at > now(), then returns only non-sensitive tracking fields (never the
-- trip PIN). trip_id is TEXT to match how the handler carries the id (a trips.id
-- UUID rendered as text); no FK so token issuance never blocks on a trip lock.
CREATE TABLE IF NOT EXISTS trip_shares (
    token       TEXT PRIMARY KEY,
    trip_id     TEXT NOT NULL,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS trip_shares_trip_idx ON trip_shares(trip_id);

ALTER TABLE trip_shares ENABLE ROW LEVEL SECURITY;

-- Owner-scoped: the rider who created the share can read/revoke it. The public
-- resolve path runs through the Go backend on the service role (below), so it is
-- not gated by this authenticated policy.
CREATE POLICY "trip_shares_own" ON trip_shares FOR SELECT TO authenticated
    USING (created_by = auth.uid());
CREATE POLICY "trip_shares_insert" ON trip_shares FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Service role bypasses RLS (Go backend uses pgx/service role).
CREATE POLICY "trip_shares_service" ON trip_shares TO service_role
    USING (TRUE) WITH CHECK (TRUE);
