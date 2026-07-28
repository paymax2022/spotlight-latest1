-- Paymax Top-5 Phase 2 — Loyalty (membership tiers + earn-rule bindings + rewards)
-- Ref: docs/estate/BUILD-PLAN.md EPIC 2.3, TOP5-BUILD-PLAN.md §7A (referral earn);
--      CLAUDE.md NL-4 (points != cash), NL-9 (idempotent earn), NL-12 (audit).
--
-- ADDITIVE-ONLY. Loyalty owns NO points ledger (that is points_ledger from the
-- credential+points migration) and NO money primitive. It binds live-module triggers
-- to points earn rules, tracks membership tiers, and surfaces a NON-CASH rewards
-- catalog (NL-4). FKs to auth.users(id). RLS everywhere with a service_role bypass.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- MEMBERSHIP — per-user tier standing. Tier re-evaluated on earn (monotonic in P1).
-- BLACK is reserved for P3 and intentionally NOT in the CHECK list yet.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_memberships (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier            text NOT NULL DEFAULT 'TIER1' CHECK (tier IN ('TIER1','TIER2','TIER3')),
  lifetime_points bigint NOT NULL DEFAULT 0 CHECK (lifetime_points >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Versioned tier thresholds + benefits (config-driven).
CREATE TABLE IF NOT EXISTS public.loyalty_tiers (
  tier             text PRIMARY KEY CHECK (tier IN ('TIER1','TIER2','TIER3')),
  threshold_points bigint NOT NULL DEFAULT 0 CHECK (threshold_points >= 0),
  benefits         jsonb NOT NULL DEFAULT '{}'::jsonb,
  active           boolean NOT NULL DEFAULT true
);

-- Earn-rule bindings: (module, trigger) -> points_earn_rules.rule_key. The points
-- engine owns the award math + versioning; this maps a live-module event onto a rule.
CREATE TABLE IF NOT EXISTS public.loyalty_earn_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module     text NOT NULL,
  trigger    text NOT NULL,
  rule_key   text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module, trigger)
);

-- Rewards catalog (a tier-gated view layer over points_catalog SKUs). kind is
-- constrained to NON-CASH rails (NL-4): no cash-out reward can exist.
CREATE TABLE IF NOT EXISTS public.loyalty_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('airtime','bill','ticket_discount','perk')),
  cost_points bigint NOT NULL CHECK (cost_points > 0),
  min_tier    text NOT NULL DEFAULT 'TIER1' CHECK (min_tier IN ('TIER1','TIER2','TIER3')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku           text NOT NULL,
  kind          text NOT NULL,
  cost_points   bigint NOT NULL CHECK (cost_points > 0),
  fulfil_status text NOT NULL DEFAULT 'PENDING' CHECK (fulfil_status IN ('PENDING','FULFILLED','FAILED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_redemptions_user ON public.loyalty_redemptions (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at trigger.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_loyalty_memberships_updated ON public.loyalty_memberships;
CREATE TRIGGER trg_loyalty_memberships_updated BEFORE UPDATE ON public.loyalty_memberships
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — owner scoped reads; config readable; service_role writes.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.loyalty_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_tiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_earn_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_catalog     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_memberships_own ON public.loyalty_memberships;
CREATE POLICY loyalty_memberships_own ON public.loyalty_memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS loyalty_memberships_service ON public.loyalty_memberships;
CREATE POLICY loyalty_memberships_service ON public.loyalty_memberships
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_tiers_read ON public.loyalty_tiers;
CREATE POLICY loyalty_tiers_read ON public.loyalty_tiers
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS loyalty_tiers_service ON public.loyalty_tiers;
CREATE POLICY loyalty_tiers_service ON public.loyalty_tiers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_earn_rules_read ON public.loyalty_earn_rules;
CREATE POLICY loyalty_earn_rules_read ON public.loyalty_earn_rules
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS loyalty_earn_rules_service ON public.loyalty_earn_rules;
CREATE POLICY loyalty_earn_rules_service ON public.loyalty_earn_rules
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_catalog_read ON public.loyalty_catalog;
CREATE POLICY loyalty_catalog_read ON public.loyalty_catalog
  FOR SELECT TO authenticated USING (active = TRUE OR public.is_admin());
DROP POLICY IF EXISTS loyalty_catalog_service ON public.loyalty_catalog;
CREATE POLICY loyalty_catalog_service ON public.loyalty_catalog
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_redemptions_own ON public.loyalty_redemptions;
CREATE POLICY loyalty_redemptions_own ON public.loyalty_redemptions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS loyalty_redemptions_service ON public.loyalty_redemptions;
CREATE POLICY loyalty_redemptions_service ON public.loyalty_redemptions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- Seed default tiers + earn rules + bindings. Idempotent (ON CONFLICT DO NOTHING).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.loyalty_tiers (tier, threshold_points, benefits, active) VALUES
  ('TIER1', 0,      '{"label":"Member"}'::jsonb,                          true),
  ('TIER2', 5000,   '{"label":"Silver","ticket_discount_pct":5}'::jsonb,  true),
  ('TIER3', 25000,  '{"label":"Gold","ticket_discount_pct":10}'::jsonb,   true)
ON CONFLICT (tier) DO NOTHING;

-- Points earn rules consumed by the points engine (version 1). value-scaled where
-- it makes sense (payments/savings), flat for tickets/referral.
INSERT INTO public.points_earn_rules (rule_key, module, version, points_fixed, points_per_kobo, expiry_days, active) VALUES
  ('payments.bill_paid',      'payments', 1, 0,   0.0001, 365, true),  -- 1pt per ₦100 spent
  ('savings.vault_deposit',   'savings',  1, 0,   0.00005,365, true),  -- 1pt per ₦200 saved
  ('tickets.ticket_purchased','tickets',  1, 50,  0.0,    365, true),  -- 50pt per ticket
  ('referral.converted',      'referral', 1, 500, 0.0,    365, true)   -- 500pt per §7A conversion
ON CONFLICT (rule_key, version) DO NOTHING;

-- Bindings: (module, trigger) -> rule_key. Loyalty.AwardFor resolves these.
INSERT INTO public.loyalty_earn_rules (module, trigger, rule_key, active) VALUES
  ('payments', 'bill_paid',         'payments.bill_paid',       true),
  ('savings',  'vault_deposit',     'savings.vault_deposit',    true),
  ('tickets',  'ticket_purchased',  'tickets.ticket_purchased', true),
  ('referral', 'converted',         'referral.converted',       true)
ON CONFLICT (module, trigger) DO NOTHING;

-- Non-cash reward catalog (mirrored into points_catalog so points.Redeem can debit).
INSERT INTO public.points_catalog (sku, title, kind, cost_points, value_kobo, active) VALUES
  ('AIRTIME_500',   '₦500 Airtime',           'airtime',         1000,  50000, true),
  ('BILL_1000',     '₦1,000 Bill Credit',     'bill',            1900, 100000, true),
  ('TICKET_10PCT',  '10% Ticket Discount',    'ticket_discount',  800,      0, true),
  ('PERK_LOUNGE',   'Event Lounge Access',    'perk',            3000,      0, true)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.loyalty_catalog (sku, title, kind, cost_points, min_tier, active) VALUES
  ('AIRTIME_500',  '₦500 Airtime',        'airtime',         1000, 'TIER1', true),
  ('BILL_1000',    '₦1,000 Bill Credit',  'bill',            1900, 'TIER1', true),
  ('TICKET_10PCT', '10% Ticket Discount', 'ticket_discount',  800, 'TIER2', true),
  ('PERK_LOUNGE',  'Event Lounge Access', 'perk',            3000, 'TIER3', true)
ON CONFLICT (sku) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — loyalty.* . Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Loyalty Tiers',   'loyalty.tiers.manage',   'loyalty','tiers',  'manage', 'Configure membership tiers',      true),
  ('Manage Loyalty Rules',   'loyalty.rules.manage',   'loyalty','rules',  'manage', 'Configure earn-rule bindings',    true),
  ('Manage Loyalty Rewards', 'loyalty.catalog.manage', 'loyalty','catalog','manage', 'Manage rewards catalog',          true),
  ('View Loyalty (Admin)',   'loyalty.read',           'loyalty','admin',  'view',   'View member loyalty standing',    true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'loyalty.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'loyalty.read')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
