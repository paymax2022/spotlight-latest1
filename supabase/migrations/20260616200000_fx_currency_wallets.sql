-- FX Lane A: Currency wallets for multi-currency balances.
-- Additive only. No DROP, no RENAME, no type narrowing.

CREATE TABLE IF NOT EXISTS public.currency_wallets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency      char(3)     NOT NULL,         -- ISO 4217: USD, GBP, EUR, etc.
  balance_minor bigint      NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

-- Prevent direct balance writes from application code (only UPDATE via FX service is allowed).
ALTER TABLE public.currency_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own currency wallets"
  ON public.currency_wallets FOR SELECT
  USING (auth.uid() = user_id);

-- Service-role can read and write (used by Go backend).
CREATE POLICY "Service role full access on currency_wallets"
  ON public.currency_wallets FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Indexes for common lookups.
CREATE INDEX IF NOT EXISTS idx_currency_wallets_user ON public.currency_wallets(user_id);

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.set_currency_wallets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_currency_wallets_updated_at ON public.currency_wallets;
CREATE TRIGGER trg_currency_wallets_updated_at
  BEFORE UPDATE ON public.currency_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_currency_wallets_updated_at();
