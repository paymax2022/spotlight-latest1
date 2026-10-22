-- Crypto deposits on the provider rail (ADR-PR855).
--
-- ADDITIVE-ONLY. Safe to re-run. Service-role writes; users read their own rows.
-- The provider credits crypto to the user's own sub-account, so a deposit posts NO
-- ledger entries. These tables are the platform's record, written by the backend only
-- from a provider RE-QUERY (never from a webhook payload alone):
--   * crypto_deposit_addresses: the address issued per (user, provider, currency, network),
--     kept once issued so the app always shows the same one.
--   * crypto_deposits: each inbound deposit as last confirmed by the provider. Status only
--     moves forward (pending -> accepted | rejected); confirmations only increase.

CREATE TABLE IF NOT EXISTS public.crypto_deposit_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  provider    TEXT NOT NULL,
  currency    TEXT NOT NULL,
  network     TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL CHECK (address <> ''),
  tag         TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, currency, network)
);

CREATE TABLE IF NOT EXISTS public.crypto_deposits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL,
  provider_deposit_id     TEXT NOT NULL,
  user_id                 UUID NOT NULL,
  currency                TEXT NOT NULL,
  network                 TEXT NOT NULL DEFAULT '',
  address                 TEXT NOT NULL DEFAULT '',
  amount                  NUMERIC(38,18) NOT NULL CHECK (amount > 0),
  fee                     NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  txid                    TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  confirmations           INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  required_confirmations  INTEGER NOT NULL DEFAULT 0 CHECK (required_confirmations >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_deposit_id)
);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_user_created
  ON public.crypto_deposits (user_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crypto_deposit_addresses','crypto_deposits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
  END LOOP;
END $$;
