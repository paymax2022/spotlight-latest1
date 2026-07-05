-- Paymax Top-5 Phase 3 — Paymax Black (top tier above TIER3) + perks + partners
-- Ref: docs/estate/BUILD-PLAN.md EPIC 3.3; docs/estate/CLAUDE.md NL-4 (perks ≠ cash),
--      NL-5 (perks, not returns), NL-12 (audit). ADDITIVE to the P2 loyalty schema —
--      it does NOT alter loyalty_memberships/loyalty_tiers (the BLACK tier is a
--      separate membership table so the P2 CHECK constraints are untouched).
--
-- Perks are NON-CASH access/content (early tickets, lounge) redeemed via the shared
-- credential primitive (single-use at event gates). Partner settlements reconcile
-- partner↔Paymax billing — the member never receives cash (NL-5). FKs to
-- auth.users(id). RLS everywhere with a service_role bypass.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- BLACK MEMBERSHIP — the top tier, granted by the upgrade/admin flow. Separate from
-- loyalty_memberships so the P2 tier engine + its CHECK list stay additive-safe.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_black_members (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state        text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','CANCELLED')),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  cancelled_at timestamptz
);

-- ════════════════════════════════════════════════════════════════════════════
-- PERKS — configurable Black benefits. redeem_via = 'credential' mints a single-use
-- credential validated at an event gate; 'entitlement' is a logical grant. kind is
-- access/content only (NL-4/NL-5) — there is no cash-out perk.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_perks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  title         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('early_access','lounge','discount','partner')),
  redeem_via    text NOT NULL DEFAULT 'credential' CHECK (redeem_via IN ('credential','entitlement')),
  max_per_month int NOT NULL DEFAULT 0 CHECK (max_per_month >= 0),  -- 0 = unlimited
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.perk_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  perk_code     text NOT NULL REFERENCES public.loyalty_perks(code) ON DELETE CASCADE,
  context_ref   text NOT NULL,                              -- event id the perk is for
  credential_id uuid,                                       -- -> credentials.id for credential perks
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_perk_redemptions_user ON public.perk_redemptions (user_id, perk_code, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PARTNERS + OFFERS + SETTLEMENTS — partner-funded perks. Settlement reconciles
-- partner↔Paymax billing for redeemed offers (kobo BIGINT). Member gets access, not cash.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_partners (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES public.loyalty_partners(id) ON DELETE CASCADE,
  title       text NOT NULL,
  perk_code   text REFERENCES public.loyalty_perks(code) ON DELETE SET NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_offers_partner ON public.partner_offers (partner_id);

CREATE TABLE IF NOT EXISTS public.partner_settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES public.loyalty_partners(id) ON DELETE CASCADE,
  offer_id    uuid REFERENCES public.partner_offers(id) ON DELETE SET NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo >= 0),
  status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_partner ON public.partner_settlements (partner_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.loyalty_black_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_perks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perk_redemptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_partners      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_settlements   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS black_members_own ON public.loyalty_black_members;
CREATE POLICY black_members_own ON public.loyalty_black_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS black_members_service ON public.loyalty_black_members;
CREATE POLICY black_members_service ON public.loyalty_black_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_perks_read ON public.loyalty_perks;
CREATE POLICY loyalty_perks_read ON public.loyalty_perks
  FOR SELECT TO authenticated USING (active = TRUE OR public.is_admin());
DROP POLICY IF EXISTS loyalty_perks_service ON public.loyalty_perks;
CREATE POLICY loyalty_perks_service ON public.loyalty_perks
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS perk_redemptions_own ON public.perk_redemptions;
CREATE POLICY perk_redemptions_own ON public.perk_redemptions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS perk_redemptions_service ON public.perk_redemptions;
CREATE POLICY perk_redemptions_service ON public.perk_redemptions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS loyalty_partners_read ON public.loyalty_partners;
CREATE POLICY loyalty_partners_read ON public.loyalty_partners
  FOR SELECT TO authenticated USING (active = TRUE OR public.is_admin());
DROP POLICY IF EXISTS loyalty_partners_service ON public.loyalty_partners;
CREATE POLICY loyalty_partners_service ON public.loyalty_partners
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS partner_offers_read ON public.partner_offers;
CREATE POLICY partner_offers_read ON public.partner_offers
  FOR SELECT TO authenticated USING (active = TRUE OR public.is_admin());
DROP POLICY IF EXISTS partner_offers_service ON public.partner_offers;
CREATE POLICY partner_offers_service ON public.partner_offers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS partner_settlements_admin ON public.partner_settlements;
CREATE POLICY partner_settlements_admin ON public.partner_settlements
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS partner_settlements_service ON public.partner_settlements;
CREATE POLICY partner_settlements_service ON public.partner_settlements
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- Seed default Black perks (NON-CASH). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.loyalty_perks (code, title, kind, redeem_via, max_per_month, active) VALUES
  ('EARLY_TICKETS', 'Early Ticket Access', 'early_access', 'credential', 0, true),
  ('LOUNGE',        'Event Lounge Access', 'lounge',       'credential', 4, true),
  ('PARTNER_DISC',  'Partner Discount',    'discount',     'entitlement',0, true)
ON CONFLICT (code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — loyalty.black.* . Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Paymax Black', 'loyalty.black.manage', 'loyalty','black','manage', 'Enroll/cancel Black, manage perks/partners/settlement', true),
  ('View Paymax Black',   'loyalty.black.read',   'loyalty','black','view',   'View Black membership + redemptions',                    true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'loyalty.black.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
