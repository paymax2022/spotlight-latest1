-- Paymax × Spotlight — Nutrition admin oversight RBAC seed
-- Ref: backend/internal/nutrition/routes.go (PermNutritionManage / PermNutritionResolve),
--      20260621040000_invest_rbac.sql (minimal grant shape mirrored below),
--      20260919000000_estate_admin_rbac.sql (module.admin.* namespace precedent).
--
-- WHY THIS MIGRATION EXISTS
-- The nutrition module's admin routes (composition/library curation, force
-- re-resolve, AND the new consult review + payouts oversight surface added to make
-- the frontend-admin nutrition console live) each gate on one of two permission
-- slugs via middleware.RequirePermission:
--     nutrition.admin.manage   — composition + library curation + read oversight
--     nutrition.admin.resolve  — force/batch resolve + human consult resolve
-- Those slugs are referenced by the Go code but were NOT seeded in any prior
-- migration (grep the repo: only the Go consts existed). Without this seed the
-- RequirePermission gate fails closed and EVERY nutrition admin request 403s.
-- This migration registers both slugs so the whole admin surface — the pre-existing
-- routes and the new consults/payouts routes — actually works.
--
-- ADDITIVE-ONLY. Only INSERT … ON CONFLICT DO NOTHING into the existing enterprise
-- RBAC tables (public.permissions / public.roles / public.role_permissions from
-- 20260527100000_enterprise_auth_rbac.sql). No DROP, no rename, no type change,
-- no existing row modified.
--
-- Naming convention (matches invest.manage / estate.admin.* / marketplace.admin.*):
--   slug = module.resource.action, module = 'nutrition'.

BEGIN;

-- 1. Nutrition admin oversight permissions -------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Nutrition Reference',
   'nutrition.admin.manage', 'nutrition', 'reference', 'manage',
   'Curate the composition reference + Nigerian Dish Library and read the nutrition admin oversight queues (consults review queue, payouts read).',
   true),
  ('Resolve Nutrition Profiles',
   'nutrition.admin.resolve', 'nutrition', 'profile', 'resolve',
   'Force/batch re-resolve dish nutrition profiles and human-resolve the admin consult review queue (POST /api/nutrition/admin/consults/:id/resolve).',
   true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant the full nutrition.admin.* set to super-admin (reachable out of box) -
WITH p AS (SELECT id FROM public.permissions WHERE module = 'nutrition')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant the full nutrition.admin.* set to system-admin (platform admin) ------
WITH p AS (SELECT id FROM public.permissions WHERE module = 'nutrition')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
