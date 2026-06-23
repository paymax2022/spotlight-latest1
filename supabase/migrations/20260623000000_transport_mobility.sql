-- Paymax Mobility — ride-hailing end-to-end.
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing.
-- Extends the existing transport module (drivers, trips) with the full
-- ride-hailing vertical: config-driven pricing, hybrid fare negotiation,
-- dispatch geo-fields, trip lifecycle, safety, ratings, onboarding, audit.

-- ─── drivers: enrich onboarding + dispatch fields (additive columns) ──────────
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone               TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS email               TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS photo_url           TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft','submitted','under_review','approved','rejected','suspended'));
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS service_categories  TEXT[] NOT NULL DEFAULT ARRAY['ride_hailing'];
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS commission_tier     TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lat         DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_lng         DOUBLE PRECISION;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS completed_trips     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cancelled_trips     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS online_since        TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS drivers_verification_idx ON drivers(verification_status);
CREATE INDEX IF NOT EXISTS drivers_geo_idx          ON drivers(current_lat, current_lng);

-- ─── trips: fine-grained lifecycle + fare + geo + safety (additive columns) ───
-- The coarse `status` column (requested/accepted/picked_up/completed/cancelled)
-- is retained for backward compatibility; `phase` carries the full state machine.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS phase             TEXT NOT NULL DEFAULT 'requested'
    CHECK (phase IN ('requested','fare_negotiating','driver_assigned','driver_arriving',
                     'pin_verified','in_progress','completed','cancelled','no_show','safety_hold'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS service_type      TEXT NOT NULL DEFAULT 'ride_hailing';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pricing_mode      TEXT NOT NULL DEFAULT 'instant'
    CHECK (pricing_mode IN ('instant','offer','scheduled'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS payment_method    TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_lat        DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_lng        DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_lat          DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_lng          DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS distance_m        INTEGER;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS duration_s        INTEGER;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS fare_estimate_kobo BIGINT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS final_fare_kobo    BIGINT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_pin           TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS safety_status      TEXT NOT NULL DEFAULT 'normal'
    CHECK (safety_status IN ('normal','sos','route_deviation','unexpected_stop','resolved'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_polyline     TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancel_reason      TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_at         TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS trips_phase_idx        ON trips(phase);
CREATE INDEX IF NOT EXISTS trips_safety_idx       ON trips(safety_status) WHERE safety_status <> 'normal';

-- ─── mobility_profiles: rider trust + saved data (layers on existing auth) ────
CREATE TABLE IF NOT EXISTS mobility_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    trust_level         TEXT NOT NULL DEFAULT 'basic'
                            CHECK (trust_level IN ('basic','verified','business')),
    default_payment     TEXT NOT NULL DEFAULT 'wallet',
    home_address        TEXT,
    work_address        TEXT,
    rating              NUMERIC(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 1 AND 5),
    completed_trips     INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','restricted','suspended')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── vehicles: richer vehicle record + compliance ─────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers(id),
    plate_number        TEXT NOT NULL,
    make                TEXT,
    model               TEXT,
    year                INTEGER CHECK (year IS NULL OR year BETWEEN 1980 AND 2100),
    color               TEXT,
    category            TEXT NOT NULL DEFAULT 'economy',
    capacity            INTEGER NOT NULL DEFAULT 4 CHECK (capacity BETWEEN 1 AND 60),
    inspection_status   TEXT NOT NULL DEFAULT 'pending'
                            CHECK (inspection_status IN ('pending','passed','failed','expired')),
    insurance_status    TEXT NOT NULL DEFAULT 'pending'
                            CHECK (insurance_status IN ('pending','valid','expired')),
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','suspended')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicles_driver_idx ON vehicles(driver_id);

-- ─── driver_documents: expiry tracking ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id   UUID NOT NULL REFERENCES drivers(id),
    doc_type    TEXT NOT NULL
                    CHECK (doc_type IN ('government_id','drivers_licence','proof_of_address',
                                        'vehicle_licence','roadworthiness','insurance','driver_photo')),
    file_url    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted','approved','rejected','expired')),
    expiry_date DATE,
    reviewed_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS driver_documents_driver_idx ON driver_documents(driver_id);
CREATE INDEX IF NOT EXISTS driver_documents_expiry_idx ON driver_documents(expiry_date) WHERE expiry_date IS NOT NULL;

-- ─── transport_pricing_config: admin-configurable, per zone ───────────────────
CREATE TABLE IF NOT EXISTS transport_pricing_config (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone                     TEXT NOT NULL DEFAULT 'default',
    service_type             TEXT NOT NULL DEFAULT 'ride_hailing',
    currency                 TEXT NOT NULL DEFAULT 'NGN',
    base_fare_kobo           BIGINT NOT NULL DEFAULT 50000,   -- ₦500
    per_km_kobo              BIGINT NOT NULL DEFAULT 12000,   -- ₦120/km
    per_min_kobo             BIGINT NOT NULL DEFAULT 2500,    -- ₦25/min
    min_fare_kobo            BIGINT NOT NULL DEFAULT 150000,  -- ₦1,500
    fare_floor_pct           NUMERIC(4,2) NOT NULL DEFAULT 0.85, -- offers >= 85% of system fare
    fare_ceiling_pct         NUMERIC(4,2) NOT NULL DEFAULT 1.50, -- offers <= 150% of system fare
    driver_profit_floor_kobo BIGINT NOT NULL DEFAULT 120000,  -- accepted fare net to driver >= ₦1,200
    surge_multiplier         NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    cancellation_fee_kobo    BIGINT NOT NULL DEFAULT 50000,
    waiting_fee_per_min_kobo BIGINT NOT NULL DEFAULT 2000,
    active                   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by               UUID,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (zone, service_type)
);

INSERT INTO transport_pricing_config (zone, service_type)
VALUES ('default','ride_hailing')
ON CONFLICT (zone, service_type) DO NOTHING;

-- ─── transport_commission_config: admin-configurable tiers ────────────────────
CREATE TABLE IF NOT EXISTS transport_commission_config (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier          TEXT NOT NULL UNIQUE
                      CHECK (tier IN ('standard','low','subscription','fleet','performance')),
    provider_pct  NUMERIC(4,3) NOT NULL DEFAULT 0.80 CHECK (provider_pct BETWEEN 0 AND 1),
    platform_pct  NUMERIC(4,3) NOT NULL DEFAULT 0.20 CHECK (platform_pct BETWEEN 0 AND 1),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by    UUID,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (provider_pct + platform_pct = 1.0)
);

INSERT INTO transport_commission_config (tier, provider_pct, platform_pct) VALUES
    ('standard', 0.800, 0.200),
    ('low',      0.880, 0.120),
    ('fleet',    0.850, 0.150)
ON CONFLICT (tier) DO NOTHING;

-- ─── fare_offers: hybrid negotiation loop ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS fare_offers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id             UUID NOT NULL REFERENCES trips(id),
    system_fare_kobo    BIGINT NOT NULL,
    rider_offer_kobo    BIGINT,
    driver_counter_kobo BIGINT,
    accepted_fare_kobo  BIGINT,
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','rider_offered','driver_countered',
                                              'accepted','rejected','expired')),
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fare_offers_trip_idx ON fare_offers(trip_id);

-- ─── trip_events: immutable lifecycle audit trail ────────────────────────────
CREATE TABLE IF NOT EXISTS trip_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID NOT NULL REFERENCES trips(id),
    event_type  TEXT NOT NULL,
    actor_id    UUID,
    from_phase  TEXT,
    to_phase    TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trip_events_trip_idx ON trip_events(trip_id);

-- ─── safety_incidents: every safety trigger creates a case ───────────────────
CREATE TABLE IF NOT EXISTS safety_incidents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES auth.users(id),
    trip_id        UUID REFERENCES trips(id),
    type           TEXT NOT NULL
                       CHECK (type IN ('sos','route_deviation','unexpected_stop','unsafe_driver',
                                       'unsafe_rider','harassment','accident','offline_trip','lost_item')),
    severity       TEXT NOT NULL DEFAULT 'medium'
                       CHECK (severity IN ('low','medium','high','critical')),
    lat            DOUBLE PRECISION,
    lng            DOUBLE PRECISION,
    description    TEXT,
    evidence_url   TEXT,
    status         TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','investigating','escalated','resolved','closed')),
    assigned_admin UUID,
    resolution_note TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS safety_incidents_status_idx ON safety_incidents(status);
CREATE INDEX IF NOT EXISTS safety_incidents_trip_idx   ON safety_incidents(trip_id);

-- ─── trusted_contacts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trusted_contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trusted_contacts_user_idx ON trusted_contacts(user_id);

-- ─── trip_ratings: bidirectional ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_ratings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID NOT NULL REFERENCES trips(id),
    rater_id    UUID NOT NULL REFERENCES auth.users(id),
    ratee_id    UUID NOT NULL REFERENCES auth.users(id),
    role        TEXT NOT NULL CHECK (role IN ('rider','driver')),
    stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment     TEXT,
    tip_kobo    BIGINT NOT NULL DEFAULT 0 CHECK (tip_kobo >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trip_id, rater_id)
);
CREATE INDEX IF NOT EXISTS trip_ratings_ratee_idx ON trip_ratings(ratee_id);

-- ─── transport_audit_log: every admin action audited ─────────────────────────
CREATE TABLE IF NOT EXISTS transport_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT,
    old_value   JSONB,
    new_value   JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transport_audit_entity_idx ON transport_audit_log(entity_type, entity_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE mobility_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_commission_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_offers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_incidents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_contacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_ratings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_audit_log      ENABLE ROW LEVEL SECURITY;

-- Owner-scoped read/write for user-facing tables.
CREATE POLICY "mobility_profiles_own" ON mobility_profiles FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "trusted_contacts_own" ON trusted_contacts FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "safety_incidents_own" ON safety_incidents FOR SELECT TO authenticated
    USING (user_id = auth.uid());
CREATE POLICY "trip_ratings_select" ON trip_ratings FOR SELECT TO authenticated
    USING (rater_id = auth.uid() OR ratee_id = auth.uid());
CREATE POLICY "trip_ratings_insert" ON trip_ratings FOR INSERT TO authenticated
    WITH CHECK (rater_id = auth.uid());

-- Pricing/commission config readable by all authenticated (client must not hard-code).
CREATE POLICY "pricing_config_read"    ON transport_pricing_config    FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "commission_config_read" ON transport_commission_config FOR SELECT TO authenticated USING (TRUE);

-- Vehicles + driver documents readable by owning driver.
CREATE POLICY "vehicles_own" ON vehicles FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = vehicles.driver_id AND d.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = vehicles.driver_id AND d.user_id = auth.uid()));
CREATE POLICY "driver_documents_own" ON driver_documents FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_documents.driver_id AND d.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_documents.driver_id AND d.user_id = auth.uid()));

-- fare_offers + trip_events readable by trip participants.
CREATE POLICY "fare_offers_select" ON fare_offers FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = fare_offers.trip_id
                   AND (t.rider_id = auth.uid()
                        OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = t.driver_id AND d.user_id = auth.uid()))));
CREATE POLICY "trip_events_select" ON trip_events FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM trips t WHERE t.id = trip_events.trip_id
                   AND (t.rider_id = auth.uid()
                        OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = t.driver_id AND d.user_id = auth.uid()))));

-- Service role bypasses RLS on every mobility table (Go backend uses pgx/service role).
CREATE POLICY "mobility_profiles_service"  ON mobility_profiles        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "vehicles_service"           ON vehicles                 TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "driver_documents_service"   ON driver_documents         TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "pricing_config_service"     ON transport_pricing_config TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "commission_config_service"  ON transport_commission_config TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "fare_offers_service"        ON fare_offers              TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "trip_events_service"        ON trip_events              TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "safety_incidents_service"   ON safety_incidents         TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "trusted_contacts_service"   ON trusted_contacts         TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "trip_ratings_service"       ON trip_ratings             TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "transport_audit_service"    ON transport_audit_log      TO service_role USING (TRUE) WITH CHECK (TRUE);
