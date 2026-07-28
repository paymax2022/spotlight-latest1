-- Paymax Connect — Discovery boosts + swipe-pass ledger + discovery RBAC (ADR-019)
-- Ref: docs/adr/ADR-019-connect-discovery-contract.md,
--      docs/prd/connect/DISCOVERY-GO-LIVE.md,
--      contracts/openapi.yaml (/api/v1/connect/discovery/*).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds
--   (ON CONFLICT DO NOTHING). NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type
--   narrowing, NO SET NOT NULL on a populated column. `DROP POLICY IF EXISTS`
--   is used only to (re)create RLS policies idempotently (module pattern). Safe
--   to re-run.
--
-- This migration adds:
--   (a) connect_boosts  — money-path discovery boosts (kobo; idempotent; ledger_ref).
--   (b) connect_passes  — records "pass" swipes (connect_likes.kind forbids 'pass',
--                          so passes need their own table so the card isn't re-shown).
--   (c) RBAC seeds       — connect.discovery.access + connect.boost.purchase, granted
--                          to the default member roles (registered-user, verified-user)
--                          and to super-admin/system-admin for completeness. Mirrors the
--                          connect_rbac / connect_money seed pattern exactly.
--   (d) connect_config   — backend-owned boost price/duration (jsonb value; public).
--
-- Reuses helpers from prior migrations: public.handle_updated_at(), public.is_admin().
-- RLS on every new table; service_role bypass (the money path writes via service role).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- (a) connect_boosts — discovery visibility boost (MONEY PATH)
--     Charged in kobo against the wallet; idempotency_key UNIQUE mirrors the
--     ledger key so a retried purchase never double-charges. ledger_ref ties the
--     boost to its posted balanced double-entry. status is forward-only in the
--     service layer (active → expired | refunded). Balances stay derived from the
--     ledger — no balance column is ever added here.
--     NOTE: id/user_id are TEXT to match the Connect member-API contract
--     (opaque string ids in camelCase JSON). No FK narrowing of prior tables.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_boosts (
  id               text PRIMARY KEY,
  user_id          text NOT NULL,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'expired', 'refunded')),
  price_kobo       bigint NOT NULL,
  duration_minutes int NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  ledger_ref       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_boosts_user_status
  ON public.connect_boosts (user_id, status);
CREATE INDEX IF NOT EXISTS idx_connect_boosts_expires
  ON public.connect_boosts (expires_at);

-- ════════════════════════════════════════════════════════════════════════════
-- (b) connect_passes — "pass" swipes. connect_likes.kind CHECK allows only
--     ('like','super'), so a pass cannot live there. Persisting passes keeps a
--     passed card from being re-shown in the stack, and lets rewind undo it.
--     FKs to connect_profiles(id) (uuid) mirror connect_likes exactly, incl. the
--     CHECK(from_profile <> to_profile) and UNIQUE(from_profile,to_profile).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_passes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_profile uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  to_profile   uuid NOT NULL REFERENCES public.connect_profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (from_profile <> to_profile),
  UNIQUE (from_profile, to_profile)           -- idempotent: one pass row per (from,to)
);
CREATE INDEX IF NOT EXISTS idx_connect_passes_to
  ON public.connect_passes (to_profile);
CREATE INDEX IF NOT EXISTS idx_connect_passes_from
  ON public.connect_passes (from_profile, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- The money/swipe paths write via the service-role backend; members read own.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_boosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_passes ENABLE ROW LEVEL SECURITY;

-- boosts: owner reads own (user_id = auth.uid()::text); admin reads all;
-- writes are service-only (the money path posts the ledger + boost row together).
DROP POLICY IF EXISTS connect_boosts_own ON public.connect_boosts;
CREATE POLICY connect_boosts_own ON public.connect_boosts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR public.is_admin());
DROP POLICY IF EXISTS connect_boosts_service ON public.connect_boosts;
CREATE POLICY connect_boosts_service ON public.connect_boosts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- passes: actor sees/creates own passes (owner of from_profile); service bypass.
-- No one reads who passed on them (mirrors connect_likes privacy).
DROP POLICY IF EXISTS connect_passes_self ON public.connect_passes;
CREATE POLICY connect_passes_self ON public.connect_passes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.connect_profiles p
                 WHERE p.id = connect_passes.from_profile AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.connect_profiles p
                      WHERE p.id = connect_passes.from_profile AND p.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_passes_service ON public.connect_passes;
CREATE POLICY connect_passes_service ON public.connect_passes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- (c) RBAC — member-facing discovery permissions (additive; ON CONFLICT DO NOTHING).
--     Reuses the enterprise RBAC tables (20260527100000_enterprise_auth_rbac.sql),
--     mirroring the seed shape in 20260627000000_connect_rbac.sql /
--     20260704000000_connect_money.sql. Unlike the admin-only connect permissions,
--     these two are MEMBER permissions, so we grant them to the default member roles
--     'registered-user' (Default authenticated user role) and 'verified-user'
--     (Verified account role) so members are NOT locked out — plus super-admin /
--     system-admin for a complete/visible role_permissions map.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Access Connect Discovery', 'connect.discovery.access', 'connect', 'discovery', 'access',   'Use the Connect discovery stack / swipe / nearby / likes-you', true),
  ('Purchase Connect Boost',   'connect.boost.purchase',   'connect', 'boost',     'purchase', 'Purchase a Connect discovery boost (wallet money path)',       true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the member discovery set to the default member roles.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.discovery.access','connect.boost.purchase'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'registered-user'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.discovery.access','connect.boost.purchase'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'verified-user'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Keep super-admin / system-admin role maps complete/visible (bypass notwithstanding).
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.discovery.access','connect.boost.purchase'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.discovery.access','connect.boost.purchase'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- (d) connect_config — backend-owned boost price/duration (jsonb; public).
--     Price/duration live HERE, never hard-coded / client-supplied.
--     50000 kobo = ₦500; 30-minute boost window.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.connect_config (key, value, scope, visibility, description) VALUES
  ('discovery.boost_price_kobo',      '50000'::jsonb, 'global', 'public', 'Price of a discovery boost in kobo (backend-owned)'),
  ('discovery.boost_duration_minutes','30'::jsonb,    'global', 'public', 'Discovery boost duration in minutes (backend-owned)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
