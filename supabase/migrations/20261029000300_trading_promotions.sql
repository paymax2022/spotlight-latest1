-- Trading promotion ladder (§12) — the audited state governing how far a strategy
-- config may act: NOT_PROMOTED → PAPER → SHADOW → CANARY → LIVE (+ HALTED).
-- Additive-only. NOTHING here executes a trade; CANARY/LIVE are eligibility states
-- and this build has no venue adapter. Real capital requires separate execution
-- wiring AND legal sign-off.

-- Per-strategy current position on the ladder + the readiness inputs a promotion
-- is judged on. One row per strategy config.
CREATE TABLE IF NOT EXISTS public.trading_strategy_promotions (
  strategy_id        text PRIMARY KEY,
  stage              text NOT NULL DEFAULT 'not_promoted'
                       CHECK (stage IN ('not_promoted','paper','shadow','canary','live','halted')),
  validation_passed  boolean NOT NULL DEFAULT false,   -- latest validate.Evaluate verdict
  track_record_days  integer NOT NULL DEFAULT 0,        -- recorded paper/shadow days
  circuit_tripped    boolean NOT NULL DEFAULT false,    -- a live breaker is currently tripped
  version            integer NOT NULL DEFAULT 0,        -- optimistic-concurrency guard
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit of every ladder transition (promotion, demotion, halt) and
-- readiness update. Never updated/deleted. Captures both parties of a maker-checker
-- promotion plus the Risk/legal sign-off flags.
CREATE TABLE IF NOT EXISTS public.trading_promotion_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id    text NOT NULL,
  event_type     text NOT NULL,                        -- register|promote|demote|halt|readiness
  old_stage      text,
  new_stage      text,
  maker_id       uuid,                                 -- proposing admin (promotions)
  checker_id     uuid,                                 -- approving admin (promotions); actor for demote/halt
  risk_signed_off  boolean,
  legal_signed_off boolean,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- A promotion event must carry two DISTINCT admins (maker-checker); demote/halt/
  -- readiness leave maker_id NULL, so the constraint only bites on promotions.
  CONSTRAINT trading_promotion_two_person
    CHECK (maker_id IS NULL OR checker_id IS NULL OR maker_id <> checker_id)
);
CREATE INDEX IF NOT EXISTS trading_promotion_events_strategy
  ON public.trading_promotion_events(strategy_id, created_at DESC);

-- RLS: admins read; service_role writes. No owner rows (strategies are platform-level).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.trading_strategy_promotions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_promotions_admin ON public.trading_strategy_promotions FOR SELECT USING (public.is_admin())';
  EXECUTE 'CREATE POLICY trading_promotions_service ON public.trading_strategy_promotions FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  EXECUTE 'ALTER TABLE public.trading_promotion_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'CREATE POLICY trading_promotion_events_admin ON public.trading_promotion_events FOR SELECT USING (public.is_admin())';
  EXECUTE 'CREATE POLICY trading_promotion_events_service ON public.trading_promotion_events FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;

-- ── RBAC: promotion permissions (§12) — separation of duties ──────────────────
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission) VALUES
  ('Propose Trading Promotion', 'trading.promotion.propose', 'trading', 'promotion', 'propose', 'Propose a strategy promotion up the ladder (maker)', true),
  ('Approve Trading Promotion', 'trading.promotion.approve', 'trading', 'promotion', 'approve', 'Second-approve a strategy promotion (checker; must differ from maker)', true),
  ('Halt Trading Strategy',     'trading.promotion.halt',    'trading', 'promotion', 'halt',    'Halt or de-risk a strategy on the ladder (Risk/admin)', true),
  ('Read Trading Promotions',   'trading.promotion.read',    'trading', 'promotion', 'read',    'Read the promotion ladder + audit', true),
  ('Sign Off Trading Risk',     'trading.promotion.risk',    'trading', 'promotion', 'risk',    'Provide the Risk sign-off required for Canary→Live', true)
ON CONFLICT (slug) DO NOTHING;

-- Dedicated Risk role (holds the Risk sign-off + halt authority).
INSERT INTO public.roles (id, name, slug, description, role_type, is_system_role, is_active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'Trading Risk Officer', 'trading-risk', 'Risk sign-off + halt authority on the promotion ladder', 'admin', true, true, now(), now())
ON CONFLICT (slug) DO NOTHING;

-- Grants: super/system-admin get everything; risk officer gets risk+halt+read.
DO $$
DECLARE r_super uuid; r_sys uuid; r_risk uuid;
BEGIN
  SELECT id INTO r_super FROM public.roles WHERE slug='super-admin';
  SELECT id INTO r_sys   FROM public.roles WHERE slug='system-admin';
  SELECT id INTO r_risk  FROM public.roles WHERE slug='trading-risk';

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r, p.id FROM (VALUES (r_super),(r_sys)) v(r), public.permissions p
    WHERE p.slug IN ('trading.promotion.propose','trading.promotion.approve','trading.promotion.halt','trading.promotion.read','trading.promotion.risk') AND r IS NOT NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r_risk, p.id FROM public.permissions p
    WHERE p.slug IN ('trading.promotion.halt','trading.promotion.risk','trading.promotion.read') AND r_risk IS NOT NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;
