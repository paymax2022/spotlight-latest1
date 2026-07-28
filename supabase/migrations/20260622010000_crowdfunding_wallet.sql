-- Crowdfunding — campaign wallet & withdrawals (additive-only).
-- Adds creator-facing withdrawal requests and saved bank accounts.
-- IRON RULES: no DROP, no RENAME, no type narrowing. All money is BIGINT kobo.
-- Withdrawal requests are created in PENDING state ONLY — no money moves here.
-- Wallet balances are NOT stored: they are derived from contributions + cf_withdrawals.

-- ─── withdrawal requests ─────────────────────────────────────────────────────
-- A request is a creator's intent to cash out. Money is moved later by an admin
-- approval flow (separate slice); this table only records the request lifecycle.
CREATE TABLE IF NOT EXISTS cf_withdrawals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    creator_id      UUID NOT NULL REFERENCES auth.users(id),
    reference       TEXT NOT NULL,
    amount_kobo     BIGINT NOT NULL CHECK (amount_kobo >= 100),
    bank_label      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PROCESSING','APPROVED','COMPLETED','REJECTED')),
    reason          TEXT,
    idempotency_key TEXT NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS cf_withdrawals_campaign_idx ON cf_withdrawals(campaign_id);
CREATE INDEX IF NOT EXISTS cf_withdrawals_creator_idx  ON cf_withdrawals(creator_id);
CREATE INDEX IF NOT EXISTS cf_withdrawals_status_idx   ON cf_withdrawals(status);

-- ─── saved bank accounts ─────────────────────────────────────────────────────
-- Account numbers are stored MASKED only (full PAN never persisted here).
CREATE TABLE IF NOT EXISTS cf_bank_accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES auth.users(id),
    bank_name             TEXT NOT NULL,
    account_number_masked TEXT NOT NULL,
    account_name          TEXT NOT NULL,
    is_default            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_bank_accounts_user_idx ON cf_bank_accounts(user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cf_withdrawals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Creators may read their own withdrawal requests; writes go through the service.
DROP POLICY IF EXISTS "cf_withdrawals_select_own" ON cf_withdrawals;
CREATE POLICY "cf_withdrawals_select_own" ON cf_withdrawals
    FOR SELECT TO authenticated USING (creator_id = auth.uid());
DROP POLICY IF EXISTS "cf_withdrawals_service" ON cf_withdrawals;
CREATE POLICY "cf_withdrawals_service" ON cf_withdrawals
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Users may read their own saved bank accounts; writes go through the service.
DROP POLICY IF EXISTS "cf_bank_accounts_select_own" ON cf_bank_accounts;
CREATE POLICY "cf_bank_accounts_select_own" ON cf_bank_accounts
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_bank_accounts_service" ON cf_bank_accounts;
CREATE POLICY "cf_bank_accounts_service" ON cf_bank_accounts
    TO service_role USING (TRUE) WITH CHECK (TRUE);
