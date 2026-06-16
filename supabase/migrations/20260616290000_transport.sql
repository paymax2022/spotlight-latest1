-- Transport module: drivers, trips, fare settlement.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── drivers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
    vehicle_reg  TEXT NOT NULL,
    vehicle_type TEXT NOT NULL DEFAULT 'car'
                     CHECK (vehicle_type IN ('car','bike','tricycle')),
    status       TEXT NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online','offline','on_trip')),
    rating       NUMERIC(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 1 AND 5),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drivers_status_idx ON drivers(status);

-- ─── trips ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id        UUID NOT NULL REFERENCES auth.users(id),
    driver_id       UUID REFERENCES drivers(id),
    pickup_address  TEXT NOT NULL,
    dest_address    TEXT NOT NULL,
    fare_kobo       BIGINT NOT NULL CHECK (fare_kobo >= 150000),
    status          TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested','accepted','picked_up','completed','cancelled')),
    idempotency_key TEXT NOT NULL,
    settlement_id   UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS trips_rider_idx   ON trips(rider_id);
CREATE INDEX IF NOT EXISTS trips_driver_idx  ON trips(driver_id);
CREATE INDEX IF NOT EXISTS trips_status_idx  ON trips(status);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips   ENABLE ROW LEVEL SECURITY;

-- Drivers list publicly readable (riders need to see available drivers).
CREATE POLICY "drivers_select" ON drivers FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "drivers_insert" ON drivers FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "drivers_update" ON drivers FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Trips visible to rider and assigned driver.
CREATE POLICY "trips_select" ON trips FOR SELECT TO authenticated
    USING (
        rider_id = auth.uid()
        OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = trips.driver_id AND d.user_id = auth.uid())
    );

CREATE POLICY "trips_insert" ON trips FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid());

-- Service role bypasses all RLS.
CREATE POLICY "drivers_service" ON drivers TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "trips_service"   ON trips   TO service_role USING (TRUE) WITH CHECK (TRUE);
