-- Seed the `finance.admin.wallets` RBAC permission.
--
-- The admin wallet-lookup endpoints
--   GET /api/finance/admin/wallets/:user_id/balance
--   GET /api/finance/admin/wallets/:user_id/transactions
-- take an ARBITRARY :user_id, so they are RBAC-gated fail-closed alongside the
-- authentication fix in finance_routes.go (the group previously ran only
-- requireUserID with nothing to set user_id, so every route 401'd and the admin
-- console's Wallet Lookup could never load). Authenticating those routes without
-- also authorizing them would let any signed-in member read any other member's
-- balance and ledger, so the permission is seeded here in the same change.
--
-- Follows 20260920000100_rbac_seed_gaps.sql exactly: additive-only, every write
-- ON CONFLICT DO NOTHING, no DROP/rename/type-narrowing, re-runnable.
--
-- ROLE MAPPING: super-admin + system-admin only — the same pair that holds
-- finance.admin.transfers / finance.admin.kyc. No dedicated finance-ops or
-- compliance operator role exists yet to grant it to.

BEGIN;

-- 1. Seed the permission ------------------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Admin Wallet Lookup', 'finance.admin.wallets', 'finance', 'wallets', 'admin',
   'Admin wallet lookup: read any member''s balance and ledger entries across wallet pots', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant to super-admin (kept complete despite the hard bypass) --------------
WITH p AS (
  SELECT id FROM public.permissions WHERE slug = 'finance.admin.wallets'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant to system-admin (platform administration operator) ------------------
WITH p AS (
  SELECT id FROM public.permissions WHERE slug = 'finance.admin.wallets'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
