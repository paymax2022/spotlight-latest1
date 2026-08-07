-- RBAC seed for the Commission & Profit management console.
-- The two slugs below are ENFORCED at the route layer via
-- middleware.RequirePermission (backend/internal/finance/commission/routes.go:16-17)
-- but were never seeded — so /admin/commission would 403 for every non-super-admin.
-- Mirrors 20260920000100_rbac_seed_gaps.sql. Additive, ON CONFLICT DO NOTHING,
-- re-runnable. Grants to super-admin + system-admin (the finance.admin.* mapping;
-- no dedicated finance/commission-ops platform role exists yet).

BEGIN;

-- 1. Register the two enforced permissions -------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Read Commission & Profit',   'finance.commission.read',   'finance', 'commission', 'read',   'View commission rate config, profit report and realized earnings (enforced commission/routes.go)', true),
  ('Manage Commission & Profit', 'finance.commission.manage', 'finance', 'commission', 'manage', 'Create/adjust/toggle commission & platform-charge rates (enforced commission/routes.go)', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant both to super-admin --------------------------------------------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN ('finance.commission.read', 'finance.commission.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant both to system-admin (platform administration operator) --------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN ('finance.commission.read', 'finance.commission.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
