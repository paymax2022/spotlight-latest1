-- Restaurant merchant WITHDRAWALS (money-path: wallet → saved bank account).
--
-- This is the money-path half of the merchant bank feature. The safe capture half
-- (restaurant_bank_accounts, 20261101000100) is a prerequisite. A withdrawal moves
-- a merchant's EARNED wallet balance (credited by paid restaurant_payout_runs) out
-- to one of their saved settlement bank accounts.
--
-- Iron rules honoured (root CLAUDE.md "Money handling") — enforced in the service
-- layer (backend/internal/restaurant/withdrawal.go):
--   - amounts are integer minor units (kobo) — BIGINT, never float/string math;
--   - the mutation REQUIRES an Idempotency-Key (idempotency_key UNIQUE NOT NULL) and
--     posts a BALANCED double-entry through the ledger (DR merchant wallet, CR the
--     failed-transfer suspense/clearing account) — never a direct balance mutation;
--   - a duplicate request is a safe no-op via the UNIQUE idempotency_key;
--   - the row is a guarded state machine (pending→processing→paid|failed|reversed);
--   - every request emits an audit event; tier limits are enforced fail-closed.
--
-- Additive-only. Mirrors the doctor_payouts / restaurant_payout_runs money-request
-- table pattern (ledger_ref, status CHECK, UNIQUE idempotency_key). Behind the
-- FEATURE_RESTAURANT_WITHDRAWALS_ENABLED flag (default OFF) at the API layer.

CREATE TABLE IF NOT EXISTS public.restaurant_withdrawals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_account_id     uuid   NOT NULL REFERENCES public.restaurant_bank_accounts(id) ON DELETE RESTRICT,
    amount_kobo         bigint NOT NULL CHECK (amount_kobo > 0),
    currency            text   NOT NULL DEFAULT 'NGN',
    status              text   NOT NULL DEFAULT 'processing'
                               CHECK (status IN ('pending','processing','paid','failed','reversed')),
    ledger_ref          text,                              -- balanced reserve-post reference ('rwithdraw:'+id)
    provider_reference  text,                              -- disbursement provider transfer ref (once wired)
    failure_reason      text,
    idempotency_key     text   NOT NULL UNIQUE,            -- required on the mutation; dedup store
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_withdrawals_user
    ON public.restaurant_withdrawals(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_withdrawals_status
    ON public.restaurant_withdrawals(status);

-- ─── RLS: owners read their own; writes go through the service role ───────────
ALTER TABLE public.restaurant_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restaurant_withdrawals_select_own" ON public.restaurant_withdrawals;
CREATE POLICY "restaurant_withdrawals_select_own" ON public.restaurant_withdrawals
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "restaurant_withdrawals_service" ON public.restaurant_withdrawals;
CREATE POLICY "restaurant_withdrawals_service" ON public.restaurant_withdrawals
    TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMENT ON TABLE public.restaurant_withdrawals IS
    'Merchant-initiated wallet→bank withdrawals (money-path). Balanced ledger reserve + guarded state machine; idempotent on idempotency_key. Behind FEATURE_RESTAURANT_WITHDRAWALS_ENABLED.';
