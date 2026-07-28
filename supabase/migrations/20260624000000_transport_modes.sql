-- Paymax Mobility — multi-modal expansion: parcel, bus, towing, movers, car hire.
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing.
-- Reuses drivers (couriers/operators are drivers with service_categories),
-- settlements/escrow, safety_incidents, trip_ratings, transport_pricing_config.

-- ─── Seed pricing config per new service_type (default zone) ──────────────────
INSERT INTO transport_pricing_config (zone, service_type, base_fare_kobo, per_km_kobo, per_min_kobo, min_fare_kobo)
VALUES
    ('default','parcel',    40000, 9000,  1500, 100000),
    ('default','towing',   300000, 20000, 0,    300000),
    ('default','car_hire', 500000, 8000,  0,    500000)
ON CONFLICT (zone, service_type) DO NOTHING;

-- ─── PARCEL DELIVERY ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parcels (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id        UUID NOT NULL REFERENCES auth.users(id),
    courier_id       UUID REFERENCES drivers(id),
    pickup_address   TEXT NOT NULL,
    pickup_lat       DOUBLE PRECISION,
    pickup_lng       DOUBLE PRECISION,
    dropoff_address  TEXT NOT NULL,
    dropoff_lat      DOUBLE PRECISION,
    dropoff_lng      DOUBLE PRECISION,
    receiver_name    TEXT NOT NULL,
    receiver_phone   TEXT NOT NULL,
    category         TEXT NOT NULL DEFAULT 'small'
                         CHECK (category IN ('document','small','medium','large','fragile','food','electronics','fashion','custom')),
    size             TEXT NOT NULL DEFAULT 'small',
    declared_value_kobo BIGINT NOT NULL DEFAULT 0 CHECK (declared_value_kobo >= 0),
    speed            TEXT NOT NULL DEFAULT 'standard' CHECK (speed IN ('standard','express','scheduled')),
    photo_url        TEXT,
    prohibited_ack   BOOLEAN NOT NULL DEFAULT FALSE,
    fare_kobo        BIGINT NOT NULL CHECK (fare_kobo >= 0),
    status           TEXT NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created','courier_assigned','pickup_pin_verified','picked_up',
                                           'in_transit','dropoff_verified','delivered','failed','disputed','cancelled')),
    pickup_pin       TEXT,
    dropoff_pin      TEXT,
    proof_url        TEXT,
    distance_m       INTEGER,
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS parcels_sender_idx  ON parcels(sender_id);
CREATE INDEX IF NOT EXISTS parcels_courier_idx ON parcels(courier_id);
CREATE INDEX IF NOT EXISTS parcels_status_idx  ON parcels(status);

-- ─── BUS BOOKING ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bus_routes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_id       UUID NOT NULL REFERENCES auth.users(id),
    origin_terminal   TEXT NOT NULL,
    dest_terminal     TEXT NOT NULL,
    distance_m        INTEGER,
    est_duration_s    INTEGER,
    category          TEXT NOT NULL DEFAULT 'standard'
                          CHECK (category IN ('economy','standard','executive','luxury','sleeper','mini','coaster','shuttle')),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_routes_operator_idx ON bus_routes(operator_id);

CREATE TABLE IF NOT EXISTS bus_schedules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id          UUID NOT NULL REFERENCES bus_routes(id),
    departure_time    TIMESTAMPTZ NOT NULL,
    arrival_estimate  TIMESTAMPTZ,
    total_seats       INTEGER NOT NULL DEFAULT 14 CHECK (total_seats BETWEEN 1 AND 80),
    fare_kobo         BIGINT NOT NULL CHECK (fare_kobo >= 0),
    fare_approved     BOOLEAN NOT NULL DEFAULT FALSE,
    status            TEXT NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','boarding','departed','completed','cancelled')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_schedules_route_idx ON bus_schedules(route_id);
CREATE INDEX IF NOT EXISTS bus_schedules_dep_idx   ON bus_schedules(departure_time);

CREATE TABLE IF NOT EXISTS bus_tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    schedule_id      UUID NOT NULL REFERENCES bus_schedules(id),
    seat_number      INTEGER NOT NULL CHECK (seat_number >= 1),
    passenger_name   TEXT NOT NULL,
    passenger_phone  TEXT,
    qr_code          TEXT NOT NULL,
    fare_kobo        BIGINT NOT NULL CHECK (fare_kobo >= 0),
    payment_status   TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','refunded')),
    boarding_status  TEXT NOT NULL DEFAULT 'issued'
                         CHECK (boarding_status IN ('issued','boarded','no_show')),
    status           TEXT NOT NULL DEFAULT 'booked'
                         CHECK (status IN ('booked','issued','boarding','boarded','completed','rescheduled','cancelled','refunded')),
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_id, seat_number)
);
CREATE INDEX IF NOT EXISTS bus_tickets_user_idx     ON bus_tickets(user_id);
CREATE INDEX IF NOT EXISTS bus_tickets_schedule_idx ON bus_tickets(schedule_id);

-- ─── TOWING / ROADSIDE ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS towing_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    operator_id      UUID REFERENCES drivers(id),
    service_type     TEXT NOT NULL DEFAULT 'tow'
                         CHECK (service_type IN ('tow','flatbed','jumpstart','tire_change','fuel','battery','unlock','mechanic')),
    vehicle_type     TEXT,
    issue_type       TEXT,
    pickup_address   TEXT NOT NULL,
    pickup_lat       DOUBLE PRECISION,
    pickup_lng       DOUBLE PRECISION,
    dest_address     TEXT,
    fare_kobo        BIGINT NOT NULL CHECK (fare_kobo >= 0),
    status           TEXT NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','operator_accepted','operator_en_route','pin_verified',
                                           'in_progress','completed','cancelled')),
    pin              TEXT,
    photos           JSONB,
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS towing_user_idx     ON towing_jobs(user_id);
CREATE INDEX IF NOT EXISTS towing_operator_idx ON towing_jobs(operator_id);
CREATE INDEX IF NOT EXISTS towing_status_idx   ON towing_jobs(status);

-- ─── MOVER TRUCKS (bidding + escrow) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mover_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    provider_id      UUID REFERENCES drivers(id),
    pickup_address   TEXT NOT NULL,
    dropoff_address  TEXT NOT NULL,
    property_type    TEXT,
    inventory        JSONB,
    truck_size       TEXT NOT NULL DEFAULT 'medium' CHECK (truck_size IN ('small','medium','large')),
    helpers          INTEGER NOT NULL DEFAULT 0 CHECK (helpers >= 0),
    fragile          BOOLEAN NOT NULL DEFAULT FALSE,
    move_at          TIMESTAMPTZ,
    accepted_bid_id  UUID,
    quote_amount_kobo BIGINT,
    status           TEXT NOT NULL DEFAULT 'quote_requested'
                         CHECK (status IN ('quote_requested','bids_received','bid_accepted','crew_assigned',
                                           'in_progress','completion_confirmed','disputed','cancelled')),
    escrow_status    TEXT NOT NULL DEFAULT 'none' CHECK (escrow_status IN ('none','funded','released','refunded')),
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mover_jobs_user_idx     ON mover_jobs(user_id);
CREATE INDEX IF NOT EXISTS mover_jobs_status_idx   ON mover_jobs(status);

CREATE TABLE IF NOT EXISTS mover_bids (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES mover_jobs(id),
    provider_id UUID NOT NULL REFERENCES drivers(id),
    amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, provider_id)
);
CREATE INDEX IF NOT EXISTS mover_bids_job_idx ON mover_bids(job_id);

-- ─── CAR HIRE / CHAUFFEUR ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS car_hire_bookings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    driver_id        UUID REFERENCES drivers(id),
    hire_type        TEXT NOT NULL DEFAULT 'daily'
                         CHECK (hire_type IN ('hourly','daily','airport','event','executive')),
    vehicle_class    TEXT NOT NULL DEFAULT 'economy',
    chauffeur        BOOLEAN NOT NULL DEFAULT TRUE,
    start_at         TIMESTAMPTZ NOT NULL,
    duration_hours   INTEGER NOT NULL DEFAULT 24 CHECK (duration_hours >= 1),
    pickup_address   TEXT,
    special_request  TEXT,
    deposit_kobo     BIGINT NOT NULL DEFAULT 0 CHECK (deposit_kobo >= 0),
    fare_kobo        BIGINT NOT NULL CHECK (fare_kobo >= 0),
    status           TEXT NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested','quoted','confirmed','active','extended','completed','cancelled')),
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS car_hire_user_idx   ON car_hire_bookings(user_id);
CREATE INDEX IF NOT EXISTS car_hire_status_idx ON car_hire_bookings(status);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE parcels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_routes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_tickets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE towing_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mover_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mover_bids        ENABLE ROW LEVEL SECURITY;
ALTER TABLE car_hire_bookings ENABLE ROW LEVEL SECURITY;

-- Owner-scoped reads for customer-facing rows; bus catalog is public-read.
CREATE POLICY "parcels_own" ON parcels FOR SELECT TO authenticated
    USING (sender_id = auth.uid()
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = parcels.courier_id AND d.user_id = auth.uid()));
CREATE POLICY "parcels_insert" ON parcels FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

CREATE POLICY "bus_routes_read"     ON bus_routes     FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "bus_schedules_read"  ON bus_schedules  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "bus_tickets_own"     ON bus_tickets    FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "bus_tickets_insert"  ON bus_tickets    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "towing_own" ON towing_jobs FOR SELECT TO authenticated
    USING (user_id = auth.uid()
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = towing_jobs.operator_id AND d.user_id = auth.uid()));
CREATE POLICY "towing_insert" ON towing_jobs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "mover_jobs_own" ON mover_jobs FOR SELECT TO authenticated
    USING (user_id = auth.uid()
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = mover_jobs.provider_id AND d.user_id = auth.uid()));
CREATE POLICY "mover_jobs_insert" ON mover_jobs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "mover_bids_read" ON mover_bids FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM mover_jobs j WHERE j.id = mover_bids.job_id AND j.user_id = auth.uid())
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = mover_bids.provider_id AND d.user_id = auth.uid()));

CREATE POLICY "car_hire_own" ON car_hire_bookings FOR SELECT TO authenticated
    USING (user_id = auth.uid()
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = car_hire_bookings.driver_id AND d.user_id = auth.uid()));
CREATE POLICY "car_hire_insert" ON car_hire_bookings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Service role bypasses RLS on every new table (Go backend uses pgx/service role).
CREATE POLICY "parcels_service"      ON parcels           TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "bus_routes_service"   ON bus_routes        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "bus_schedules_service" ON bus_schedules    TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "bus_tickets_service"  ON bus_tickets       TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "towing_service"       ON towing_jobs       TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "mover_jobs_service"   ON mover_jobs        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "mover_bids_service"   ON mover_bids        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "car_hire_service"     ON car_hire_bookings TO service_role USING (TRUE) WITH CHECK (TRUE);
