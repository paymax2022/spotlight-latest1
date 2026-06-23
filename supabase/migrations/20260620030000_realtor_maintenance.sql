-- Realtor module — maintenance triangle (tenant → manager → vendor) (V2)
-- ADDITIVE ONLY. Costs roll up to the owner cockpit. Money is BIGINT minor units.

CREATE TABLE IF NOT EXISTS realtor_maintenance_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    unit_id             UUID REFERENCES realtor_units(id) ON DELETE SET NULL,
    lease_id            UUID REFERENCES realtor_leases(id) ON DELETE SET NULL,
    vendor_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    -- denormalised display fields (filled from the lease/unit at creation)
    unit_label          VARCHAR(120),
    property_name       VARCHAR(200),
    area                VARCHAR(120),
    category            VARCHAR(20) NOT NULL,
    urgency             VARCHAR(12) NOT NULL DEFAULT 'normal'
                        CHECK (urgency IN ('low','normal','high','emergency')),
    title               VARCHAR(200) NOT NULL,
    description         TEXT,
    media               JSONB NOT NULL DEFAULT '[]'::JSONB,
    status              VARCHAR(20) NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted','manager_review','vendor_assigned','quote_submitted',
                                          'quote_approved','quote_rejected','in_progress','completed',
                                          'tenant_confirmed','closed','cancelled')),
    vendor              JSONB,                      -- {id,name,trade,rating,...}
    quote_amount_kobo   BIGINT,
    quote_note          TEXT,
    completion_evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
    rating              SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    emergency_bypass    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_maint_tenant ON realtor_maintenance_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_realtor_maint_vendor ON realtor_maintenance_requests(vendor_id);
CREATE INDEX IF NOT EXISTS idx_realtor_maint_status ON realtor_maintenance_requests(status);

ALTER TABLE realtor_maintenance_requests ENABLE ROW LEVEL SECURITY;

-- Tenant manages their own requests.
CREATE POLICY "Tenant manages own maintenance"
    ON realtor_maintenance_requests FOR ALL
    USING (tenant_id = auth.uid());

-- Assigned vendor can read + update jobs assigned to them (status/evidence/quote).
CREATE POLICY "Vendor sees assigned jobs"
    ON realtor_maintenance_requests FOR SELECT
    USING (vendor_id = auth.uid());
CREATE POLICY "Vendor updates assigned jobs"
    ON realtor_maintenance_requests FOR UPDATE
    USING (vendor_id = auth.uid());

-- Owner/manager of the property can read requests on their units.
CREATE POLICY "Owner sees property maintenance"
    ON realtor_maintenance_requests FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM realtor_units u
        JOIN realtor_properties p ON p.id = u.property_id
        JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
        WHERE u.id = realtor_maintenance_requests.unit_id AND pf.owner_id = auth.uid()
    ));
