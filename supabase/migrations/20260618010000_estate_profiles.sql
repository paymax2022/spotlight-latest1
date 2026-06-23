-- Block 25: Resident profiles, household members, domestic staff, vehicles
-- Additive only.

-- ── Resident profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resident_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id          UUID NOT NULL UNIQUE REFERENCES estate_residents(id) ON DELETE CASCADE,
    bio                  TEXT,
    profile_photo_url    TEXT,
    phone                VARCHAR(30),
    alt_phone            VARCHAR(30),
    emergency_contact    JSONB DEFAULT '{}'::JSONB,  -- {name, phone, relationship}
    next_of_kin          JSONB DEFAULT '{}'::JSONB,  -- {name, phone, relationship, address}
    occupancy_type       VARCHAR(20) NOT NULL DEFAULT 'resident'
                         CHECK (occupancy_type IN ('resident','tenant','homeowner','landlord')),
    lease_start          DATE,
    lease_end            DATE,
    agreement_url        TEXT,
    ownership_doc_url    TEXT,
    visibility           VARCHAR(20) NOT NULL DEFAULT 'members'
                         CHECK (visibility IN ('public','members','admin_only')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resident_profiles_resident ON resident_profiles(resident_id);

ALTER TABLE resident_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Resident manages own profile"
    ON resident_profiles FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.id = resident_profiles.resident_id AND er.user_id = auth.uid()
        )
    );
CREATE POLICY "Estate members view visible profiles"
    ON resident_profiles FOR SELECT
    USING (
        visibility = 'members' AND EXISTS (
            SELECT 1 FROM estate_residents er1
            JOIN estate_residents er2 ON er1.estate_id = er2.estate_id
            WHERE er2.id = resident_profiles.resident_id AND er1.user_id = auth.uid()
        )
    );

-- ── Household members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS household_members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id   UUID NOT NULL REFERENCES estate_residents(id) ON DELETE CASCADE,
    full_name     VARCHAR(200) NOT NULL,
    relationship  VARCHAR(50) NOT NULL,
    dob           DATE,
    id_type       VARCHAR(30),  -- nin | passport | drivers_license | voter_card
    id_number     VARCHAR(60),
    photo_url     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_members_resident ON household_members(resident_id);

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Resident manages own household"
    ON household_members FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.id = household_members.resident_id AND er.user_id = auth.uid()
        )
    );

-- ── Domestic staff ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS domestic_staff (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id   UUID NOT NULL REFERENCES estate_residents(id) ON DELETE CASCADE,
    full_name     VARCHAR(200) NOT NULL,
    role          VARCHAR(80) NOT NULL,  -- cook | cleaner | nanny | driver | security | other
    photo_url     TEXT,
    id_type       VARCHAR(30),
    id_number     VARCHAR(60),
    phone         VARCHAR(30),
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','terminated')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domestic_staff_resident ON domestic_staff(resident_id);

ALTER TABLE domestic_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Resident manages own staff"
    ON domestic_staff FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.id = domestic_staff.resident_id AND er.user_id = auth.uid()
        )
    );

-- ── Resident vehicles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resident_vehicles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id   UUID NOT NULL REFERENCES estate_residents(id) ON DELETE CASCADE,
    plate         VARCHAR(20) NOT NULL,
    make          VARCHAR(80),
    model         VARCHAR(80),
    color         VARCHAR(40),
    doc_url       TEXT,
    verified      BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by   UUID REFERENCES auth.users(id),
    verified_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(resident_id, plate)
);

CREATE INDEX IF NOT EXISTS idx_resident_vehicles_resident ON resident_vehicles(resident_id);
CREATE INDEX IF NOT EXISTS idx_resident_vehicles_plate    ON resident_vehicles(plate);

ALTER TABLE resident_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Resident manages own vehicles"
    ON resident_vehicles FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.id = resident_vehicles.resident_id AND er.user_id = auth.uid()
        )
    );
CREATE POLICY "Estate members view verified vehicles"
    ON resident_vehicles FOR SELECT
    USING (
        verified = TRUE AND EXISTS (
            SELECT 1 FROM estate_residents er1
            JOIN estate_residents er2 ON er1.estate_id = er2.estate_id
            WHERE er2.id = resident_vehicles.resident_id AND er1.user_id = auth.uid()
        )
    );
