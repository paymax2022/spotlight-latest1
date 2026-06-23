-- Block 24: Estate onboarding, property selection, join flows
-- Additive only. No DROP, no column renames, no type narrowing.

-- ── Invite codes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_invite_codes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id    UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    created_by   UUID NOT NULL REFERENCES auth.users(id),
    code         VARCHAR(12) NOT NULL UNIQUE,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    used_count   INTEGER NOT NULL DEFAULT 0,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estate_invite_codes_estate ON estate_invite_codes(estate_id);
CREATE INDEX IF NOT EXISTS idx_estate_invite_codes_code   ON estate_invite_codes(code);

ALTER TABLE estate_invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estate admin manages invite codes"
    ON estate_invite_codes FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents
            WHERE estate_id = estate_invite_codes.estate_id
              AND user_id = auth.uid()
              AND role = 'estate_admin'
        )
    );

-- ── Join requests ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_join_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES auth.users(id),
    message       TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
    reviewed_by   UUID REFERENCES auth.users(id),
    reviewed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(estate_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_estate_join_requests_estate  ON estate_join_requests(estate_id);
CREATE INDEX IF NOT EXISTS idx_estate_join_requests_user    ON estate_join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_estate_join_requests_status  ON estate_join_requests(estate_id, status);

ALTER TABLE estate_join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own requests"
    ON estate_join_requests FOR SELECT
    USING (user_id = auth.uid());
CREATE POLICY "Estate admin manages requests"
    ON estate_join_requests FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents
            WHERE estate_id = estate_join_requests.estate_id
              AND user_id = auth.uid()
              AND role = 'estate_admin'
        )
    );

-- ── Estate properties ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_properties (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id        UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    unit_label       VARCHAR(100) NOT NULL,
    property_type    VARCHAR(30) NOT NULL DEFAULT 'apartment'
                     CHECK (property_type IN ('apartment','house','commercial','land','other')),
    floor            VARCHAR(20),
    block            VARCHAR(50),
    occupancy_status VARCHAR(20) NOT NULL DEFAULT 'vacant'
                     CHECK (occupancy_status IN ('vacant','occupied','reserved')),
    landlord_id      UUID REFERENCES auth.users(id),
    tenant_id        UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estate_properties_estate    ON estate_properties(estate_id);
CREATE INDEX IF NOT EXISTS idx_estate_properties_landlord  ON estate_properties(landlord_id);
CREATE INDEX IF NOT EXISTS idx_estate_properties_tenant    ON estate_properties(tenant_id);

ALTER TABLE estate_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estate members view properties"
    ON estate_properties FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents
            WHERE estate_id = estate_properties.estate_id
              AND user_id = auth.uid()
        )
    );
CREATE POLICY "Estate admin manages properties"
    ON estate_properties FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_residents
            WHERE estate_id = estate_properties.estate_id
              AND user_id = auth.uid()
              AND role = 'estate_admin'
        )
    );

-- ── Property ownership claims ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_ownership_claims (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id      UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES auth.users(id),
    ownership_doc_url TEXT NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
    verified_by      UUID REFERENCES auth.users(id),
    verified_at      TIMESTAMPTZ,
    reject_reason    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ownership_claims_property ON property_ownership_claims(property_id);
CREATE INDEX IF NOT EXISTS idx_ownership_claims_user     ON property_ownership_claims(user_id);

ALTER TABLE property_ownership_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User sees own claims"
    ON property_ownership_claims FOR SELECT
    USING (user_id = auth.uid());
CREATE POLICY "Estate admin manages claims"
    ON property_ownership_claims FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM estate_properties ep
            JOIN estate_residents er ON er.estate_id = ep.estate_id
            WHERE ep.id = property_ownership_claims.property_id
              AND er.user_id = auth.uid()
              AND er.role = 'estate_admin'
        )
    );

-- ── Tenancy requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenancy_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES auth.users(id),
    landlord_id     UUID NOT NULL REFERENCES auth.users(id),
    lease_start     DATE NOT NULL,
    lease_end       DATE,
    agreement_url   TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','cancelled')),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(property_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenancy_requests_property  ON tenancy_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_tenancy_requests_tenant    ON tenancy_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenancy_requests_landlord  ON tenancy_requests(landlord_id);

ALTER TABLE tenancy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant or landlord sees own requests"
    ON tenancy_requests FOR SELECT
    USING (tenant_id = auth.uid() OR landlord_id = auth.uid());
CREATE POLICY "Tenant creates request"
    ON tenancy_requests FOR INSERT
    WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Landlord updates status"
    ON tenancy_requests FOR UPDATE
    USING (landlord_id = auth.uid());
