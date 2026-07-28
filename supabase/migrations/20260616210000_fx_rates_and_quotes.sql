-- FX Lane A: Rate cache + provider quotes.
-- Additive only.

-- fx_rates: cached rates fetched from Maplerad (ES-synced for admin search).
CREATE TABLE IF NOT EXISTS public.fx_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency char(3)     NOT NULL,
  target_currency char(3)     NOT NULL,
  rate            numeric(20,8) NOT NULL,
  spread_pct      numeric(5,4) NOT NULL DEFAULT 0.015, -- 1.5% default markup
  provider        text        NOT NULL DEFAULT 'maplerad',
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_currency, target_currency, provider)
);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on fx_rates"
  ON public.fx_rates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Public read fx_rates"
  ON public.fx_rates FOR SELECT USING (true);

-- fx_quotes: per-user quote reserved in Redis and persisted for audit.
CREATE TABLE IF NOT EXISTS public.fx_quotes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id),
  provider_quote_id   text,
  source_currency     char(3)     NOT NULL,
  target_currency     char(3)     NOT NULL,
  source_amount_kobo  bigint      NOT NULL CHECK (source_amount_kobo > 0),
  target_amount_minor bigint      NOT NULL CHECK (target_amount_minor > 0),
  rate                numeric(20,8) NOT NULL,
  fee_kobo            bigint      NOT NULL DEFAULT 0,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fx_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own fx_quotes"
  ON public.fx_quotes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access on fx_quotes"
  ON public.fx_quotes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fx_quotes_user ON public.fx_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_fx_quotes_expires ON public.fx_quotes(expires_at);
