-- Crypto provider-driven swaps + inbound webhook dedupe (Phase 1, flag-off).
--
-- ADDITIVE-ONLY. Safe to re-run. Two new tables, nothing existing is touched.
--   * crypto_webhook_events: the PK on `key` is the dedupe guard. A delivery is
--     processed once; if processing fails the row is deleted so the provider's retry
--     re-runs it (spec 8.3). Payload is the provider's raw data object for diagnostics
--     only — value is never released from it.
--   * crypto_swaps: one row per provider swap. `status` follows the swap state machine
--     (cryptoprov.SwapState); transitions are conditional UPDATEs (WHERE status = from).
--     Amounts are exact decimals. NGN money in the ledger stays integer kobo; ledger_ref
--     points at the future ledger posting and is NULL until settlement exists.
-- Written by the service role only; users read their own swaps.

CREATE TABLE IF NOT EXISTS public.crypto_webhook_events (
  key         TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_webhook_events_received
  ON public.crypto_webhook_events (received_at);

CREATE TABLE IF NOT EXISTS public.crypto_swaps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_quote_id   TEXT,
  provider_swap_id    TEXT,
  from_currency       TEXT NOT NULL,
  to_currency         TEXT NOT NULL,
  from_amount         NUMERIC(38,18) NOT NULL CHECK (from_amount > 0),
  quoted_to_amount    NUMERIC(38,18) NOT NULL CHECK (quoted_to_amount > 0),
  received_amount     NUMERIC(38,18),
  quoted_price        NUMERIC(38,18) NOT NULL CHECK (quoted_price > 0),
  status              TEXT NOT NULL DEFAULT 'quoted'
    CHECK (status IN ('quoted','confirming','processing','completed','failed','expired','needs_review')),
  reason              TEXT,
  expires_at          TIMESTAMPTZ,
  ledger_ref          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_swaps_provider_swap
  ON public.crypto_swaps (provider, provider_swap_id) WHERE provider_swap_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crypto_swaps_user ON public.crypto_swaps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_swaps_open
  ON public.crypto_swaps (status, updated_at) WHERE status IN ('confirming','processing','needs_review');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crypto_webhook_events','crypto_swaps'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS crypto_swaps_owner ON public.crypto_swaps';
  EXECUTE 'CREATE POLICY crypto_swaps_owner ON public.crypto_swaps FOR SELECT USING (public.is_admin() OR user_id = auth.uid())';
END $$;
