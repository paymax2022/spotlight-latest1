-- Paymax Crypto module — buy/sell of crypto assets against the main NGN wallet.
-- Additive-only (no DROP / rename / type-narrowing). Reuses the finance ledger:
-- a BUY debits the user wallet into the shared escrow standing account and credits
-- the user's crypto holding (an append-only projection); a SELL reverses. All
-- monetary amounts are integers in minor units (kobo for NGN cash; per-asset minor
-- units for holdings — see crypto_assets.minor_unit_scale / crypto_holdings.units).
-- Every money mutation requires an Idempotency-Key (crypto_orders.idempotency_key
-- is uniquely enforced), posts a balanced double-entry ledger pair, and emits an
-- audit event (crypto_audit_log). Holdings are NEVER mutated as a source of truth
-- in a way that bypasses the order/ledger flow.
BEGIN;

-- ── Tradable crypto assets (admin-curated catalogue) ──────────────────────────
-- minor_unit_scale = number of integer minor units per 1 whole asset unit (e.g.
-- 1e8 "satoshi-like" units). price_kobo is the NGN price (kobo) per 1 WHOLE asset
-- unit at snapshot time. Holdings are stored in these integer minor units.
CREATE TABLE IF NOT EXISTS public.crypto_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           text NOT NULL UNIQUE,                 -- e.g. BTC, ETH, USDT
  name             text NOT NULL,
  minor_unit_scale bigint NOT NULL DEFAULT 100000000,    -- integer minor units per 1 whole unit
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_assets_active ON public.crypto_assets(is_active);

-- ── Orders (immutable money-path record; idempotency-keyed) ───────────────────
-- side: buy|sell. cash_kobo = NGN cash leg (kobo). units = asset minor units moved.
-- price_kobo = NGN price (kobo) per 1 WHOLE asset unit used for this fill.
CREATE TABLE IF NOT EXISTS public.crypto_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES public.crypto_assets(id),
  side            text NOT NULL CHECK (side IN ('buy','sell')),
  status          text NOT NULL DEFAULT 'filled' CHECK (status IN ('pending','filled','failed')),
  cash_kobo       bigint NOT NULL CHECK (cash_kobo > 0),
  units           bigint NOT NULL CHECK (units > 0),
  price_kobo      bigint NOT NULL CHECK (price_kobo > 0),
  idempotency_key text NOT NULL,
  reference       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Idempotency: at most one order per key (partial index ignores NULL keys, though
-- the column is NOT NULL — kept partial to match the codebase convention).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crypto_orders_idem
  ON public.crypto_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crypto_orders_user ON public.crypto_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_orders_asset ON public.crypto_orders(asset_id);

-- ── Holdings (projection of filled orders; per-user, per-asset) ────────────────
-- units is the integer minor-unit position. It is only ever moved through the
-- order/ledger flow; the cash leg lives in the finance ledger (escrow standing
-- account) — this table is the asset-unit side of the same balanced movement.
CREATE TABLE IF NOT EXISTS public.crypto_holdings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id   uuid NOT NULL REFERENCES public.crypto_assets(id),
  units      bigint NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_crypto_holdings_user ON public.crypto_holdings(user_id);

-- ── Price snapshots (audit trail of quotes used for fills) ─────────────────────
CREATE TABLE IF NOT EXISTS public.crypto_price_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id   uuid NOT NULL REFERENCES public.crypto_assets(id),
  price_kobo bigint NOT NULL CHECK (price_kobo > 0),     -- NGN kobo per 1 whole unit
  source     text NOT NULL DEFAULT 'mock',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_price_asset ON public.crypto_price_snapshots(asset_id, created_at DESC);

-- ── Audit log (immutable, append-only) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crypto_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_audit_created ON public.crypto_audit_log(created_at DESC);

-- ── RLS ──
DO $$
DECLARE
  owner_tables text[] := ARRAY['crypto_orders','crypto_holdings'];
  public_read  text[] := ARRAY['crypto_assets'];
  admin_only   text[] := ARRAY['crypto_price_snapshots','crypto_audit_log'];
  t text;
BEGIN
  FOREACH t IN ARRAY owner_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_owner ON public.%I FOR SELECT USING (public.is_admin() OR user_id = auth.uid())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY public_read LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
  FOREACH t IN ARRAY admin_only LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_admin ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_admin ON public.%I FOR SELECT USING (public.is_admin())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

-- ── RBAC ── view (read catalogue/portfolio), trade (buy/sell), admin (catalogue + orders).
INSERT INTO public.permissions (slug, description) VALUES
  ('crypto.view','View crypto assets, quotes and own portfolio/holdings'),
  ('crypto.trade','Place crypto buy/sell orders'),
  ('crypto.admin','Administer crypto assets, view all orders and configuration')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.slug LIKE 'crypto.%' AND r.slug IN ('super-admin','system-admin')
ON CONFLICT DO NOTHING;

COMMIT;
