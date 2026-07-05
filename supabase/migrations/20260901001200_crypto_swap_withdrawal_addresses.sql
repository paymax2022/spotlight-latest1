-- Paymax Crypto — swap orders, withdrawal state machine, and address allow-list.
-- Additive-only (no DROP / rename / type-narrowing). Extends the crypto module
-- (see 20260815001600_crypto.sql) with three money-safe subsystems:
--
--   1. crypto_swap_orders  — two-leg atomic asset→asset order (sell A, buy B) under
--      ONE idempotency envelope. Holdings move only through this row + the finance
--      ledger cash legs; the spread is retained to paymax_revenue (never minted).
--   2. crypto_addresses     — per-user whitelisted destination allow-list. A
--      withdrawal MUST target a saved, active address (allow-list enforced).
--   3. crypto_withdrawals    — explicit withdrawal state machine
--      (requested→pending→broadcast→confirmed | failed). Debits the user's crypto
--      holding units into a per-row "withdrawal-pending" parked position (no
--      minting); the fiat processing fee debits the wallet to paymax_revenue. A
--      pluggable provider adapter performs the (mock) broadcast — no real on-chain
--      call. On `failed`, parked units are returned to the holding.
--   4. crypto_deposit_addresses — per-user, per-asset deposit address, generated
--      deterministically (or by a provider) and persisted so it is stable.
--
-- All monetary amounts are integers in minor units (kobo for NGN cash; per-asset
-- minor units for holdings). Every money mutation is idempotency-keyed, posts a
-- balanced double-entry ledger pair for the cash leg, and audits via crypto_audit_log.
BEGIN;

-- ── Swap orders (asset A → asset B, one atomic order) ─────────────────────────
-- from_units leave the `from` holding; to_units enter the `to` holding. The
-- indicative cash value of the sell leg is cash_kobo; the spread (fee) is
-- spread_kobo, routed to paymax_revenue via the finance ledger. price fields are
-- NGN kobo per 1 WHOLE unit of each asset at fill time.
CREATE TABLE IF NOT EXISTS public.crypto_swap_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_asset_id     uuid NOT NULL REFERENCES public.crypto_assets(id),
  to_asset_id       uuid NOT NULL REFERENCES public.crypto_assets(id),
  status            text NOT NULL DEFAULT 'filled' CHECK (status IN ('pending','filled','failed')),
  from_units        bigint NOT NULL CHECK (from_units > 0),
  to_units          bigint NOT NULL CHECK (to_units > 0),
  from_price_kobo   bigint NOT NULL CHECK (from_price_kobo > 0),
  to_price_kobo     bigint NOT NULL CHECK (to_price_kobo > 0),
  cash_kobo         bigint NOT NULL CHECK (cash_kobo > 0),      -- indicative sell-leg value
  spread_kobo       bigint NOT NULL DEFAULT 0 CHECK (spread_kobo >= 0),
  spread_bps        integer NOT NULL DEFAULT 0 CHECK (spread_bps >= 0),
  idempotency_key   text NOT NULL,
  reference         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_asset_id <> to_asset_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_swap_orders_idem
  ON public.crypto_swap_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crypto_swap_orders_user ON public.crypto_swap_orders(user_id, created_at DESC);

-- ── Address allow-list (whitelisted withdrawal destinations) ──────────────────
-- A withdrawal may only target one of the caller's own active addresses. label is
-- a user-friendly name; verified_at records first-use screening. network is a free
-- text tag mirroring the asset's supported networks (client-supplied, validated
-- against a non-empty allow rule in the service).
CREATE TABLE IF NOT EXISTS public.crypto_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES public.crypto_assets(id),
  label        text NOT NULL DEFAULT '',
  network      text NOT NULL DEFAULT '',
  address      text NOT NULL CHECK (length(btrim(address)) >= 8),
  is_active    boolean NOT NULL DEFAULT true,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- One active row per (user, asset, address): re-adding the same address is a no-op
-- via ON CONFLICT. Soft-delete flips is_active=false (the partial unique still lets
-- the user re-add later since inactive rows are excluded).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_addresses_active
  ON public.crypto_addresses(user_id, asset_id, address) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_crypto_addresses_user ON public.crypto_addresses(user_id, created_at DESC);

-- ── Deposit addresses (per-user, per-asset; persisted & stable) ───────────────
CREATE TABLE IF NOT EXISTS public.crypto_deposit_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES public.crypto_assets(id),
  network      text NOT NULL DEFAULT '',
  address      text NOT NULL,
  memo         text,
  provider     text NOT NULL DEFAULT 'mock-custody',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_crypto_deposit_user ON public.crypto_deposit_addresses(user_id);

-- ── Withdrawals (explicit state machine) ──────────────────────────────────────
-- units are the asset minor units leaving the holding (parked in this row until a
-- terminal state). network_fee_units is the in-asset miner fee estimate;
-- fee_kobo is the fiat processing fee (debited to paymax_revenue). address_id
-- pins the whitelisted destination used. provider/provider_ref/tx_hash record the
-- pluggable broadcast adapter's output. status is the persisted state machine.
CREATE TABLE IF NOT EXISTS public.crypto_withdrawals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL REFERENCES public.crypto_assets(id),
  address_id        uuid NOT NULL REFERENCES public.crypto_addresses(id),
  status            text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','pending','broadcast','confirmed','failed')),
  units             bigint NOT NULL CHECK (units > 0),          -- asset minor units debited
  network_fee_units bigint NOT NULL DEFAULT 0 CHECK (network_fee_units >= 0),
  fee_kobo          bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),  -- fiat processing fee
  price_kobo        bigint NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),
  provider          text NOT NULL DEFAULT 'mock',
  provider_ref      text,
  tx_hash           text,
  failure_reason    text,
  idempotency_key   text NOT NULL,
  reference         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_withdrawals_idem
  ON public.crypto_withdrawals(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crypto_withdrawals_user ON public.crypto_withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_withdrawals_status ON public.crypto_withdrawals(status);

-- Append-only transition log for the withdrawal state machine (who/when/why).
CREATE TABLE IF NOT EXISTS public.crypto_withdrawal_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id  uuid NOT NULL REFERENCES public.crypto_withdrawals(id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  actor_id       text,
  detail         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_wd_events ON public.crypto_withdrawal_events(withdrawal_id, created_at);

-- ── RLS ── owner-read (user's own rows) + service-role full; is_admin bypass.
DO $$
DECLARE
  owner_tables text[] := ARRAY[
    'crypto_swap_orders','crypto_addresses','crypto_deposit_addresses','crypto_withdrawals'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  -- withdrawal_events: admin-read + service-role full (no direct member writes).
  EXECUTE 'ALTER TABLE public.crypto_withdrawal_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_withdrawal_events_admin ON public.crypto_withdrawal_events';
  EXECUTE 'CREATE POLICY crypto_withdrawal_events_admin ON public.crypto_withdrawal_events FOR SELECT USING (public.is_admin())';
  EXECUTE 'DROP POLICY IF EXISTS crypto_withdrawal_events_service ON public.crypto_withdrawal_events';
  EXECUTE 'CREATE POLICY crypto_withdrawal_events_service ON public.crypto_withdrawal_events FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;

COMMIT;
