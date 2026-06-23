-- Paymax Mobility — final modes: business logistics + event transport (Spotlight).
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing.
-- Composes on parcel + ride/bus + settlement/escrow. event_id is a loose reference
-- (no FK) so this migration stays decoupled from the Spotlight events schema.

-- ─── Seed pricing for the two new service_types ──────────────────────────────
INSERT INTO transport_pricing_config (zone, service_type, base_fare_kobo, per_km_kobo, per_min_kobo, min_fare_kobo)
VALUES
    ('default','business_logistics', 35000, 8000, 1200, 80000),
    ('default','event_transport',    50000, 10000, 2000, 150000)
ON CONFLICT (zone, service_type) DO NOTHING;

-- ─── BUSINESS LOGISTICS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    name          TEXT NOT NULL,
    account_type  TEXT NOT NULL DEFAULT 'sme'
                      CHECK (account_type IN ('sme','restaurant','pharmacy','shop','ecommerce','event_org','film','estate')),
    billing_mode  TEXT NOT NULL DEFAULT 'prepaid_wallet'
                      CHECK (billing_mode IN ('prepaid_wallet','monthly_invoice')),
    cod_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_batches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES business_accounts(id),
    name         TEXT NOT NULL,
    total_stops  INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created','dispatched','in_progress','completed','partially_failed','cancelled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS delivery_batches_business_idx ON delivery_batches(business_id);

CREATE TABLE IF NOT EXISTS business_deliveries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id         UUID REFERENCES delivery_batches(id),
    business_id      UUID NOT NULL REFERENCES business_accounts(id),
    courier_id       UUID REFERENCES drivers(id),
    sequence         INTEGER NOT NULL DEFAULT 1,
    pickup_address   TEXT NOT NULL,
    pickup_lat       DOUBLE PRECISION,
    pickup_lng       DOUBLE PRECISION,
    dropoff_address  TEXT NOT NULL,
    dropoff_lat      DOUBLE PRECISION,
    dropoff_lng      DOUBLE PRECISION,
    receiver_name    TEXT NOT NULL,
    receiver_phone   TEXT NOT NULL,
    parcel_size      TEXT NOT NULL DEFAULT 'small',
    cod_kobo         BIGINT NOT NULL DEFAULT 0 CHECK (cod_kobo >= 0),
    fare_kobo        BIGINT NOT NULL DEFAULT 0 CHECK (fare_kobo >= 0),
    status           TEXT NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created','assigned','picked_up','delivered','failed','cancelled')),
    failure_reason   TEXT,
    dropoff_pin      TEXT,
    proof_url        TEXT,
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_deliveries_business_idx ON business_deliveries(business_id);
CREATE INDEX IF NOT EXISTS business_deliveries_batch_idx    ON business_deliveries(batch_id);
CREATE INDEX IF NOT EXISTS business_deliveries_status_idx   ON business_deliveries(status);

CREATE TABLE IF NOT EXISTS business_invoices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES business_accounts(id),
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    delivery_count INTEGER NOT NULL DEFAULT 0,
    total_kobo    BIGINT NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','issued','paid','void')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS business_invoices_business_idx ON business_invoices(business_id);

-- ─── EVENT TRANSPORT (Spotlight) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_transport_offers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         TEXT,                         -- loose ref to Spotlight events (no FK)
    organizer_id     UUID NOT NULL REFERENCES auth.users(id),
    type             TEXT NOT NULL DEFAULT 'group_ride'
                         CHECK (type IN ('group_ride','fan_bus','shuttle','artist','crew','equipment_van')),
    title            TEXT NOT NULL,
    venue_address    TEXT,
    venue_lat        DOUBLE PRECISION,
    venue_lng        DOUBLE PRECISION,
    geofence_radius_m INTEGER NOT NULL DEFAULT 500,
    capacity         INTEGER NOT NULL DEFAULT 14 CHECK (capacity >= 1),
    booked_count     INTEGER NOT NULL DEFAULT 0,
    fare_kobo        BIGINT NOT NULL DEFAULT 0 CHECK (fare_kobo >= 0),
    departure_time   TIMESTAMPTZ,
    bus_schedule_id  UUID REFERENCES bus_schedules(id),
    promo_code       TEXT,
    status           TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('draft','open','full','departed','completed','cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS event_offers_event_idx     ON event_transport_offers(event_id);
CREATE INDEX IF NOT EXISTS event_offers_organizer_idx ON event_transport_offers(organizer_id);
CREATE INDEX IF NOT EXISTS event_offers_status_idx    ON event_transport_offers(status);

CREATE TABLE IF NOT EXISTS event_transport_bookings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id         UUID NOT NULL REFERENCES event_transport_offers(id),
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    ticket_ref       TEXT,                         -- loose ref to a Spotlight event ticket
    seats            INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
    fare_kobo        BIGINT NOT NULL CHECK (fare_kobo >= 0),
    qr_code          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'booked'
                         CHECK (status IN ('booked','confirmed','boarded','completed','cancelled','refunded')),
    settlement_id    UUID,
    idempotency_key  TEXT UNIQUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS event_bookings_offer_idx ON event_transport_bookings(offer_id);
CREATE INDEX IF NOT EXISTS event_bookings_user_idx  ON event_transport_bookings(user_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE business_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_batches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_transport_offers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_transport_bookings ENABLE ROW LEVEL SECURITY;

-- Business owner scopes their own data.
CREATE POLICY "business_accounts_own" ON business_accounts FOR ALL TO authenticated
    USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "delivery_batches_own" ON delivery_batches FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM business_accounts b WHERE b.id = delivery_batches.business_id AND b.owner_id = auth.uid()));
CREATE POLICY "business_deliveries_own" ON business_deliveries FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM business_accounts b WHERE b.id = business_deliveries.business_id AND b.owner_id = auth.uid())
           OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = business_deliveries.courier_id AND d.user_id = auth.uid()));
CREATE POLICY "business_invoices_own" ON business_invoices FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM business_accounts b WHERE b.id = business_invoices.business_id AND b.owner_id = auth.uid()));

-- Event offers are public-read (riders browse them); bookings are owner-scoped.
CREATE POLICY "event_offers_read" ON event_transport_offers FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "event_bookings_own" ON event_transport_bookings FOR SELECT TO authenticated
    USING (user_id = auth.uid());
CREATE POLICY "event_bookings_insert" ON event_transport_bookings FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Service role bypasses RLS on every new table.
CREATE POLICY "business_accounts_service"   ON business_accounts        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "delivery_batches_service"    ON delivery_batches         TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "business_deliveries_service" ON business_deliveries      TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "business_invoices_service"   ON business_invoices        TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "event_offers_service"        ON event_transport_offers   TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "event_bookings_service"      ON event_transport_bookings TO service_role USING (TRUE) WITH CHECK (TRUE);
