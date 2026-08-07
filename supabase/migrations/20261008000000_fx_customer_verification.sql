-- FX customer verification / KYC persistence. Replaces the contract-shaped stub
-- (handler_stubs.go GetVerification/SubmitCustomer/RestartVerification) with a real
-- durable record: one row per FX customer holding the KYC status, account type, tier,
-- the submitted payload (jsonb, for audit/manual review), and the review outcome.
--
-- Additive-only. Auth is enforced in the service layer (customer-scoped by the
-- authenticated customer id), matching the other orch_fx_* tables (no RLS).

CREATE TABLE IF NOT EXISTS orch_fx_customer_verifications (
    customer_id      text PRIMARY KEY,
    status           text NOT NULL DEFAULT 'unstarted'
                         CHECK (status IN ('unstarted','pending','review','approved','rejected')),
    account_type     text NOT NULL DEFAULT 'individual'
                         CHECK (account_type IN ('individual','business')),
    tier             int  NOT NULL DEFAULT 0,
    submission       jsonb,                 -- the KycSubmission payload, kept for manual review
    rejection_reason text,
    submitted_at     timestamptz,
    reviewed_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Review queue: pending/review rows first, oldest submission first.
CREATE INDEX IF NOT EXISTS orch_fx_customer_verifications_status_idx
    ON orch_fx_customer_verifications (status, submitted_at);
