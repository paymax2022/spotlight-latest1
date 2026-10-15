-- Crypto buy pipeline: provider accounts + quote idempotency (ADR-PR710).
--
-- ADDITIVE-ONLY. Safe to re-run. Service-role only; users read their own rows.
--   * crypto_accounts: one custodial provider sub-account per (user, provider), created on
--     first trade. The unique index is the guard against a second account being created.
--   * crypto_swaps gains the quote data the confirm step needs (currencies, amounts, price,
--     provider quote id already exists) and an idempotency_key: a retried quote request with
--     the same key returns the same row instead of creating a second quote.

CREATE TABLE IF NOT EXISTS public.crypto_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

--   * execute_attempted_at is stamped immediately BEFORE the provider is asked to execute. A
--     swap that has it but no provider_swap_id has an unknown outcome and must never be
--     re-executed or refunded blindly (ADR-PR710).
ALTER TABLE public.crypto_swaps
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS execute_attempted_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_swaps_user_idem
  ON public.crypto_swaps (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.crypto_accounts ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_accounts_service ON public.crypto_accounts';
  EXECUTE 'CREATE POLICY crypto_accounts_service ON public.crypto_accounts FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'DROP POLICY IF EXISTS crypto_accounts_owner ON public.crypto_accounts';
  EXECUTE 'CREATE POLICY crypto_accounts_owner ON public.crypto_accounts FOR SELECT USING (public.is_admin() OR user_id = auth.uid())';
END $$;
