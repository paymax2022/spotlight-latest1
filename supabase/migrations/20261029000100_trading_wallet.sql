-- Custodial trading fund — unitized-NAV fund accounting tables (Pillar 2, §3).
-- Additive-only. Money in NGN kobo (BIGINT); units are integer-scaled (UnitScale
-- 1e6 in Go) — never NUMERIC/FLOAT. All cash still moves through the finance
-- ledger (ledger_accounts/ledger_entries); THESE tables are only the unit/NAV/fee
-- PROJECTION and the per-order idempotency journal. No balance column here is
-- authoritative for cash — the ledger is.
--
-- NOTE: paper/accounting only in this slice — no venue positions exist yet, so
-- fund AUM == the trading_fund_clearing ledger balance.

-- Per-user unit holding (the ownership projection; analogue of crypto_holdings).
CREATE TABLE IF NOT EXISTS public.trading_fund_units (
  user_id    uuid PRIMARY KEY,
  units      bigint NOT NULL DEFAULT 0 CHECK (units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable NAV history — one row per snapshot (scheduled or on-demand).
CREATE TABLE IF NOT EXISTS public.trading_nav_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nav_per_unit_kobo  bigint NOT NULL CHECK (nav_per_unit_kobo >= 0),
  total_units        bigint NOT NULL CHECK (total_units >= 0),
  aum_kobo           bigint NOT NULL CHECK (aum_kobo >= 0),
  clearing_kobo      bigint NOT NULL DEFAULT 0,   -- ledger clearing balance at snapshot (reconciliation)
  idempotency_key    text,
  as_of              timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trading_nav_snapshots_idem
  ON public.trading_nav_snapshots(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Subscription (deposit→mint) and redemption (withdraw→burn) legs. The
-- idempotency_key makes each order replay-safe independently of the ledger leg.
CREATE TABLE IF NOT EXISTS public.trading_fund_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('subscribe','redeem')),
  cash_kobo        bigint NOT NULL CHECK (cash_kobo >= 0),
  units_delta      bigint NOT NULL,                 -- +units on subscribe, -units on redeem
  nav_per_unit_kobo bigint NOT NULL CHECK (nav_per_unit_kobo >= 0),
  nav_snapshot_id  uuid REFERENCES public.trading_nav_snapshots(id),
  ledger_ref       text,
  idempotency_key  text NOT NULL,
  -- settled=false is a RESERVATION: the units/NAV are pinned and the cash leg is
  -- in flight but the unit balance is not yet applied. A subscribe reserves →
  -- debits → settles, so a crash-retry re-drives to the SAME reserved units
  -- (never recomputing NAV against the post-deposit balance). Redeems are written
  -- settled=true directly (units are an input, not NAV-derived).
  settled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trading_fund_orders_idem
  ON public.trading_fund_orders(idempotency_key);
CREATE INDEX IF NOT EXISTS trading_fund_orders_user ON public.trading_fund_orders(user_id, created_at DESC);

-- High-water mark per user (NAV per whole unit at last fee crystallization).
CREATE TABLE IF NOT EXISTS public.trading_hwm_watermarks (
  user_id            uuid PRIMARY KEY,
  high_water_nav_kobo bigint NOT NULL DEFAULT 0 CHECK (high_water_nav_kobo >= 0),
  last_assessed_at   timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Performance-fee accrual journal (fee ledgered DEBIT user_wallet → CREDIT
-- trading_fee_income). Idempotency-keyed so a re-assessment never double-charges.
CREATE TABLE IF NOT EXISTS public.trading_fee_accruals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  period           text,
  nav_now_kobo     bigint NOT NULL CHECK (nav_now_kobo >= 0),
  hwm_before_kobo  bigint NOT NULL CHECK (hwm_before_kobo >= 0),
  hwm_after_kobo   bigint NOT NULL CHECK (hwm_after_kobo >= 0),
  profit_kobo      bigint NOT NULL DEFAULT 0,
  fee_kobo         bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  units_burned     bigint NOT NULL DEFAULT 0 CHECK (units_burned >= 0),  -- units taken from the holder to pay the fee
  ledger_ref       text,
  idempotency_key  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trading_fee_accruals_idem
  ON public.trading_fee_accruals(idempotency_key);
CREATE INDEX IF NOT EXISTS trading_fee_accruals_user ON public.trading_fee_accruals(user_id, created_at DESC);

-- RLS: a user sees their own rows; admins (is_admin) see all; only service_role writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trading_fund_units','trading_fund_orders','trading_hwm_watermarks','trading_fee_accruals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  -- NAV snapshots are fund-wide (no user_id): admin-readable, service-writable.
  EXECUTE 'ALTER TABLE public.trading_nav_snapshots ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_nav_snapshots_admin ON public.trading_nav_snapshots FOR SELECT USING (public.is_admin())';
  EXECUTE 'CREATE POLICY trading_nav_snapshots_service ON public.trading_nav_snapshots FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;
