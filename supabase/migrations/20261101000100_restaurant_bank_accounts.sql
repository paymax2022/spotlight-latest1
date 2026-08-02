-- Restaurant merchant settlement bank accounts (capture only — NO money movement).
--
-- Stores the bank account a restaurant merchant wants earnings paid out to. This
-- is the safe, additive prerequisite for merchant-initiated withdrawals; the
-- actual wallet→bank disbursement (money-path: balanced ledger post + provider
-- disbursement + idempotency + ledger-auditor review) is a SEPARATE later slice.
--
-- Additive-only. Mirrors doctor_bank_accounts / cf_bank_accounts. Account numbers
-- are stored in full (needed for a future disbursement) but MUST be masked to the
-- last 4 digits at the API read layer.

CREATE TABLE IF NOT EXISTS public.restaurant_bank_accounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_name       text NOT NULL,
    bank_code       text NOT NULL,
    account_number  text NOT NULL,            -- full; masked to last-4 at the API layer
    account_name    text NOT NULL,
    is_verified     boolean NOT NULL DEFAULT false,  -- name-enquiry verification (later)
    is_default      boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, bank_code, account_number)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_bank_accounts_user
    ON public.restaurant_bank_accounts(user_id);

-- At most one default per owner (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_bank_accounts_default
    ON public.restaurant_bank_accounts(user_id)
    WHERE is_default;

-- ─── RLS: owners read their own; writes go through the service role ───────────
ALTER TABLE public.restaurant_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restaurant_bank_accounts_select_own" ON public.restaurant_bank_accounts;
CREATE POLICY "restaurant_bank_accounts_select_own" ON public.restaurant_bank_accounts
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "restaurant_bank_accounts_service" ON public.restaurant_bank_accounts;
CREATE POLICY "restaurant_bank_accounts_service" ON public.restaurant_bank_accounts
    TO service_role USING (TRUE) WITH CHECK (TRUE);
