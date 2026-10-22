-- Inbound crypto-deposit settlement (GAP-DEP-01, Option A).
-- Additive only: a new immutable, once-per-provider-operation money-IN journal. It does
-- NOT touch finance/ledger or any existing table. The credit it authorises is applied to
-- the EXISTING crypto_holdings projection (the single source of customer crypto-unit
-- balances that Portfolio/Withdraw/Sell already read) inside the same transaction, so
-- deposits never fork a second balance plane. Custody-side conservation is reconciled by
-- the existing crypto_onchain_balances feed (ReconRow ledger_units vs onchain_units).
--
-- Idempotency surface: provider_op_id is the provider's unique deposit operation id; its
-- UNIQUE constraint makes a replayed/duplicate webhook (E2E-10 storm) a no-op — exactly
-- one credit per real inbound transfer.

CREATE TABLE IF NOT EXISTS public.crypto_deposits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text   NOT NULL,
  provider_account_id text   NOT NULL,
  provider_op_id      text   NOT NULL UNIQUE,          -- idempotency anchor
  user_id             uuid   NOT NULL,                 -- resolved owner (server-side)
  asset_id            uuid   NOT NULL,                 -- resolved crypto_assets.id
  symbol              text   NOT NULL,
  network             text   NOT NULL,
  address             text   NOT NULL,
  units               bigint NOT NULL CHECK (units > 0),
  confirmations       int    NOT NULL,
  required_confs      int    NOT NULL,
  tx_hash             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  credited_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crypto_deposits_user_asset
  ON public.crypto_deposits (user_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_account
  ON public.crypto_deposits (provider, provider_account_id);

ALTER TABLE public.crypto_deposits
  DROP CONSTRAINT IF EXISTS crypto_deposits_user_fk,
  ADD CONSTRAINT crypto_deposits_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.crypto_deposits ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_deposits_service ON public.crypto_deposits';
  EXECUTE 'CREATE POLICY crypto_deposits_service ON public.crypto_deposits FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'DROP POLICY IF EXISTS crypto_deposits_owner ON public.crypto_deposits';
  EXECUTE 'CREATE POLICY crypto_deposits_owner ON public.crypto_deposits FOR SELECT USING (public.is_admin() OR user_id = auth.uid())';
END $$;
