-- Realtor module — lease, e-sign, rent/deposit payment, escrow, move-in (V2)
-- ADDITIVE ONLY. Continues the funnel: application -> lease -> invoice -> escrow -> move-in.
-- Money is BIGINT minor units (kobo).

-- ── Lease ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_leases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id  UUID NOT NULL REFERENCES realtor_rental_applications(id) ON DELETE CASCADE,
    listing_id      UUID NOT NULL REFERENCES realtor_listings(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status          VARCHAR(28) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','awaiting_tenant_signature','awaiting_landlord_signature','signed','active','ended')),
    rent_schedule   VARCHAR(12) NOT NULL DEFAULT 'annual',
    rent_kobo       BIGINT NOT NULL DEFAULT 0,
    caution_kobo    BIGINT NOT NULL DEFAULT 0,
    service_charge_kobo BIGINT,
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    clauses         JSONB NOT NULL DEFAULT '[]'::JSONB,
    tenant_signed   BOOLEAN NOT NULL DEFAULT FALSE,
    landlord_signed BOOLEAN NOT NULL DEFAULT FALSE,
    tenant_signature_name VARCHAR(200),
    signed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_leases_tenant ON realtor_leases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_realtor_leases_application ON realtor_leases(application_id);

-- ── Rent / deposit invoice ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id        UUID NOT NULL REFERENCES realtor_leases(id) ON DELETE CASCADE,
    status          VARCHAR(12) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','paid','failed')),
    lines           JSONB NOT NULL DEFAULT '[]'::JSONB,    -- [{label, amount_kobo, refundable}]
    total_kobo      BIGINT NOT NULL DEFAULT 0,
    due_date        DATE,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_invoices_lease ON realtor_invoices(lease_id);

-- ── Payment (immutable record; every money mutation is idempotent) ───────────
CREATE TABLE IF NOT EXISTS realtor_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES realtor_invoices(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    channel         VARCHAR(12) NOT NULL CHECK (channel IN ('WALLET','PAYSTACK')),
    amount_kobo     BIGINT NOT NULL,
    escrow_held_kobo BIGINT NOT NULL DEFAULT 0,
    status          VARCHAR(12) NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing','paid','failed')),
    reference       VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,           -- blocks double-charge on retry
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_realtor_payments_invoice ON realtor_payments(invoice_id);

-- ── Escrow deposit ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_escrow_deposits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id          UUID NOT NULL REFERENCES realtor_leases(id) ON DELETE CASCADE,
    amount_kobo       BIGINT NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'held'
                      CHECK (status IN ('held','release_requested','released','disputed')),
    release_condition TEXT,
    held_since        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_realtor_escrow_lease ON realtor_escrow_deposits(lease_id);

-- ── Move-in ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_move_ins (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lease_id            UUID NOT NULL UNIQUE REFERENCES realtor_leases(id) ON DELETE CASCADE,
    checklist           JSONB NOT NULL DEFAULT '[]'::JSONB,
    keys_handed_over     BOOLEAN NOT NULL DEFAULT FALSE,
    occupancy_activated  BOOLEAN NOT NULL DEFAULT FALSE,
    activated_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE realtor_leases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_escrow_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtor_move_ins        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant manages own lease"
    ON realtor_leases FOR ALL
    USING (tenant_id = auth.uid());

CREATE POLICY "Tenant sees own invoices"
    ON realtor_invoices FOR SELECT
    USING (EXISTS (SELECT 1 FROM realtor_leases l WHERE l.id = realtor_invoices.lease_id AND l.tenant_id = auth.uid()));

CREATE POLICY "User manages own payments"
    ON realtor_payments FOR ALL
    USING (user_id = auth.uid());

CREATE POLICY "Tenant sees own escrow"
    ON realtor_escrow_deposits FOR SELECT
    USING (EXISTS (SELECT 1 FROM realtor_leases l WHERE l.id = realtor_escrow_deposits.lease_id AND l.tenant_id = auth.uid()));

CREATE POLICY "Tenant manages own move-in"
    ON realtor_move_ins FOR ALL
    USING (EXISTS (SELECT 1 FROM realtor_leases l WHERE l.id = realtor_move_ins.lease_id AND l.tenant_id = auth.uid()));
