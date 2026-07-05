-- Block 42: vendor / contractor app.
--
-- Extends the vendor directory with self-onboarding profile fields and the job
-- record with the full lifecycle (quote/invoice/completion evidence + payout
-- tracking). Additive-only.

ALTER TABLE estate_vendors
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS specialties   TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS bank_account  JSONB  NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS verified      BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE vendor_jobs
    ADD COLUMN IF NOT EXISTS title                  TEXT,
    ADD COLUMN IF NOT EXISTS quote_kobo             BIGINT CHECK (quote_kobo IS NULL OR quote_kobo >= 0),
    ADD COLUMN IF NOT EXISTS invoice_url            TEXT,
    ADD COLUMN IF NOT EXISTS completion_url         TEXT,
    ADD COLUMN IF NOT EXISTS accepted_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_at                TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payout_ref             TEXT,
    ADD COLUMN IF NOT EXISTS payout_idempotency_key TEXT;

-- Idempotent payouts: at most one successful payout per key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_jobs_payout_idem
    ON vendor_jobs (payout_idempotency_key) WHERE payout_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_jobs_vendor ON vendor_jobs (vendor_id, status);
