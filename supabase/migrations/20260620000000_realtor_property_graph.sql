-- Realtor module — property graph + connected funnel (discovery → inspection → application)
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
-- Mirrors the "one property graph, many offering modes" model and the funnel
-- entities defined in mobile-app/reactnative/src/features/realtor/types/realtor.types.ts.
-- All monetary amounts are BIGINT minor units (kobo) — never floats.

-- ── Portfolio ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_portfolios (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name          VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_portfolios_owner ON realtor_portfolios(owner_id);

-- ── Property (building) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_properties (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portfolio_id  UUID NOT NULL REFERENCES realtor_portfolios(id) ON DELETE CASCADE,
    name          VARCHAR(200) NOT NULL,
    property_type VARCHAR(30) NOT NULL,             -- apartment|flat|duplex|... (see constants)
    address       TEXT NOT NULL,
    area          VARCHAR(120) NOT NULL,
    city          VARCHAR(120) NOT NULL,
    state         VARCHAR(120) NOT NULL,
    geo_lat       NUMERIC(9,6),
    geo_lng       NUMERIC(9,6),
    amenities     JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_properties_portfolio ON realtor_properties(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_realtor_properties_area ON realtor_properties(area);

-- ── Unit ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_units (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id   UUID NOT NULL REFERENCES realtor_properties(id) ON DELETE CASCADE,
    label         VARCHAR(120) NOT NULL,            -- "Flat 3B"
    property_type VARCHAR(30) NOT NULL,
    bedrooms      SMALLINT NOT NULL DEFAULT 0,
    bathrooms     SMALLINT NOT NULL DEFAULT 0,
    toilets       SMALLINT NOT NULL DEFAULT 0,
    size_sqm      NUMERIC(8,2),
    furnishing    VARCHAR(20) NOT NULL DEFAULT 'unfurnished',
    status        VARCHAR(20) NOT NULL DEFAULT 'vacant'
                  CHECK (status IN ('vacant','listed','reserved','occupied','under_maintenance')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_units_property ON realtor_units(property_id);
CREATE INDEX IF NOT EXISTS idx_realtor_units_status ON realtor_units(status);

-- ── Room (sub-unit for shared / hotel / co-living) ───────────────────────────
CREATE TABLE IF NOT EXISTS realtor_rooms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id       UUID NOT NULL REFERENCES realtor_units(id) ON DELETE CASCADE,
    label         VARCHAR(120) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_rooms_unit ON realtor_rooms(unit_id);

-- ── Offering mode (pluggable monetisation on a unit) ─────────────────────────
CREATE TABLE IF NOT EXISTS realtor_offering_modes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id         UUID NOT NULL REFERENCES realtor_units(id) ON DELETE CASCADE,
    mode            VARCHAR(20) NOT NULL
                    CHECK (mode IN ('for_sale','for_lease','long_rent','short_stay')),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    price_kobo      BIGINT NOT NULL DEFAULT 0,      -- sale price OR per-schedule rent
    rent_schedule   VARCHAR(12)                     -- annual|biannual|quarterly|monthly
                    CHECK (rent_schedule IS NULL OR rent_schedule IN ('annual','biannual','quarterly','monthly')),
    nightly_kobo    BIGINT,                          -- short_stay only
    caution_kobo    BIGINT,                          -- refundable, escrow-eligible
    service_charge_kobo BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (unit_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_realtor_offering_modes_unit ON realtor_offering_modes(unit_id);

-- ── Listing (marketplace projection of a unit in one offering mode) ──────────
CREATE TABLE IF NOT EXISTS realtor_listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id         UUID NOT NULL REFERENCES realtor_units(id) ON DELETE CASCADE,
    offering_mode_id UUID REFERENCES realtor_offering_modes(id) ON DELETE SET NULL,
    agent_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title           VARCHAR(240) NOT NULL,
    mode            VARCHAR(20) NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','pending_verification','published','unavailable','suspended')),
    verification    VARCHAR(20) NOT NULL DEFAULT 'unverified'
                    CHECK (verification IN ('unverified','document_backed','inspected','verified')),
    escrow_protected BOOLEAN NOT NULL DEFAULT FALSE,
    price_kobo      BIGINT NOT NULL DEFAULT 0,
    nightly_kobo    BIGINT,
    caution_kobo    BIGINT,                                -- refundable deposit, escrow-eligible
    service_charge_kobo BIGINT,
    inspection_fee_kobo BIGINT,                            -- optional viewing fee
    rent_schedule   VARCHAR(12),
    fees            JSONB NOT NULL DEFAULT '[]'::JSONB,    -- [{label, amount_kobo, refundable}]
    description     TEXT,
    media           JSONB NOT NULL DEFAULT '[]'::JSONB,    -- image urls, [0] = cover
    inspection_required  BOOLEAN NOT NULL DEFAULT TRUE,
    application_required BOOLEAN NOT NULL DEFAULT TRUE,
    featured        BOOLEAN NOT NULL DEFAULT FALSE,
    price_drop_from_kobo BIGINT,
    view_count      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_listings_status ON realtor_listings(status);
CREATE INDEX IF NOT EXISTS idx_realtor_listings_mode ON realtor_listings(mode);
CREATE INDEX IF NOT EXISTS idx_realtor_listings_agent ON realtor_listings(agent_id);

-- ── Inspection booking (listing → viewing) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_inspection_bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES realtor_listings(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','rescheduled','checked_in','completed','cancelled','no_show')),
    viewing_mode    VARCHAR(10) NOT NULL DEFAULT 'physical'
                    CHECK (viewing_mode IN ('physical','virtual')),
    scheduled_date  DATE NOT NULL,
    scheduled_time  VARCHAR(8) NOT NULL,
    attendee_name   VARCHAR(200) NOT NULL,
    attendee_phone  VARCHAR(30) NOT NULL,
    note            TEXT,
    fee_kobo        BIGINT,
    client_ref      VARCHAR(64),                     -- idempotency surrogate for retried submits
    -- prevents the same slot being double-booked for a listing
    UNIQUE (listing_id, scheduled_date, scheduled_time),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_inspections_user ON realtor_inspection_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_realtor_inspections_listing ON realtor_inspection_bookings(listing_id);

-- ── Rental application (inspection → application) ────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_rental_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES realtor_listings(id) ON DELETE CASCADE,
    inspection_id   UUID REFERENCES realtor_inspection_bookings(id) ON DELETE SET NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('draft','submitted','under_review','more_info_required',
                                      'approved','rejected','offer_sent','withdrawn')),
    full_name       VARCHAR(200) NOT NULL,
    email           VARCHAR(200) NOT NULL,
    phone           VARCHAR(30) NOT NULL,
    occupants       SMALLINT NOT NULL DEFAULT 1,
    move_in_date    DATE,
    employment_status VARCHAR(20),
    employer_name   VARCHAR(200),
    monthly_income_kobo BIGINT NOT NULL DEFAULT 0,
    guarantor       JSONB NOT NULL DEFAULT '{}'::JSONB,   -- {name, phone, relationship}
    documents       JSONB NOT NULL DEFAULT '[]'::JSONB,   -- [{id,label,uploaded,required}]
    screening_consent BOOLEAN NOT NULL DEFAULT FALSE,
    review_note     TEXT,
    client_ref      VARCHAR(64),                     -- idempotency surrogate for retried submits
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_applications_user ON realtor_rental_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_realtor_applications_listing ON realtor_rental_applications(listing_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE realtor_portfolios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_properties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_units                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_rooms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_offering_modes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_listings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_inspection_bookings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_rental_applications   ENABLE ROW LEVEL SECURITY;

-- Marketplace: published listings are world-readable (discovery is public).
CREATE POLICY "Published listings are public"
    ON realtor_listings FOR SELECT
    USING (status = 'published');

-- Portfolio owners manage their own graph.
CREATE POLICY "Owner manages own portfolio"
    ON realtor_portfolios FOR ALL
    USING (owner_id = auth.uid());

-- Funnel records are private to the user who created them (plus the listing agent,
-- enforced at the service layer). Users see and manage only their own.
CREATE POLICY "User manages own inspections"
    ON realtor_inspection_bookings FOR ALL
    USING (user_id = auth.uid());

CREATE POLICY "User manages own applications"
    ON realtor_rental_applications FOR ALL
    USING (user_id = auth.uid());
