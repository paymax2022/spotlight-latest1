-- Restaurant / Delivery — merchant KYB (Know Your Business) onboarding (Phase 8).
--
-- Turns the placeholder onboarding surface (which had no document/KYC store) into a
-- real business-verification record: legal identity, CAC registration, settlement
-- (payout) bank account, uploaded documents, and a review state machine. A restaurant
-- goes live (is_open=true) only via KYB approval. Additive-only — no DROP / RENAME /
-- type narrowing; existing restaurants with no KYB row are unaffected.

-- Snapshot of the KYB verdict on the restaurant row (fast reads / go-live gate). NULL
-- for legacy restaurants that predate KYB.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS kyb_status TEXT
    CHECK (kyb_status IS NULL OR kyb_status IN
        ('draft','submitted','under_review','needs_more_info','approved','rejected'));

-- ─── restaurant_kyb ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_kyb (
    restaurant_id   UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
    legal_name      TEXT,
    business_type   TEXT CHECK (business_type IS NULL OR business_type IN
                        ('sole_proprietor','limited_company','partnership','ngo')),
    rc_number       TEXT,   -- CAC RC/BN number
    tin             TEXT,   -- tax identification number
    contact_email   TEXT,
    contact_phone   TEXT,
    bank_code       TEXT,           -- settlement (payout) account — the merchant's OWN account
    account_number  TEXT CHECK (account_number IS NULL OR account_number ~ '^[0-9]{10}$'),
    account_name    TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','under_review','needs_more_info','approved','rejected')),
    decision_reason TEXT,
    reviewed_by     UUID,
    submitted_at    TIMESTAMPTZ,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS restaurant_kyb_status_idx ON restaurant_kyb(status);

-- ─── restaurant_kyb_documents ─────────────────────────────────────────────────
-- References to supporting documents the owner has ALREADY uploaded to storage (R2)
-- via a presigned URL; this table stores only the resulting file reference + type, not
-- the file itself. doc_type is an open vocabulary (cac_certificate, proof_of_address,
-- director_id, utility_bill, …).
CREATE TABLE IF NOT EXISTS restaurant_kyb_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    doc_type      TEXT NOT NULL CHECK (char_length(doc_type) BETWEEN 2 AND 64),
    file_url      TEXT NOT NULL,
    file_name     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, doc_type)
);
CREATE INDEX IF NOT EXISTS restaurant_kyb_documents_rest_idx ON restaurant_kyb_documents(restaurant_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE restaurant_kyb           ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_kyb_documents ENABLE ROW LEVEL SECURITY;
-- KYB records hold sensitive business/settlement data: no client policy is granted; the
-- Go service (owner-checked reads/writes; reviewer-permission decisions) is the only path.
