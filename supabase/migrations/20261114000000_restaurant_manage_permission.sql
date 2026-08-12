-- Seed the missing `restaurant.manage` RBAC permission — additive-only.
--
-- WHY
-- 20260919000200_restaurant_admin_rbac.sql states in its header that "the
-- restaurant module already ships `restaurant.manage` (broad manage)" and builds
-- the four restaurant.admin.* slugs around that assumption. It does not. No
-- migration anywhere inserts it:
--
--   SELECT slug FROM permissions WHERE slug LIKE 'restaurant%';
--   → restaurant.admin.{dispatch,disputes,onboarding,payouts,pricing}   (5 rows)
--
-- The consequences were invisible because nothing enforced it until now:
--   * frontend-admin/app/admin/restaurant/_ui.tsx RESTAURANT_PERMS.manage
--     resolved to a slug no role could hold, so `can(manage)` was always false.
--   * The dispatch/onboarding/disputes entries list restaurant.manage as an
--     OR-alternative, so they kept working via their own slug and masked this.
--   * The new admin store & menu routes (/api/restaurant/admin/restaurants/*)
--     guard on restaurant.manage, so EVERY one of them would fail closed with
--     403 for every operator including super-admin.
--
-- This is the broad "operate any merchant's storefront" grant: edit the profile,
-- force a store open/closed, and manage its menu on the merchant's behalf. It is
-- deliberately separate from the narrow restaurant.admin.* queue slugs so ops
-- staff can work a queue without gaining write access to merchant storefronts.
--
-- SAFETY: additive-only per CLAUDE.md — INSERT ... ON CONFLICT DO NOTHING only.
-- No DROP, no RENAME, no type narrowing, no existing row modified. Re-runnable.

BEGIN;

-- 1. The permission itself -----------------------------------------------------
-- Naming matches the module.resource.action convention used by the sibling
-- restaurant.admin.* slugs and by estate.admin.* / marketplace.admin.*.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES (
  'Manage Restaurants',
  'restaurant.manage',
  'restaurant',
  'restaurant',
  'manage',
  'Operate any merchant storefront: edit the store profile, force open/close, and manage menu categories and items on the merchant''s behalf (GET/PATCH /restaurant/admin/restaurants/:id, PATCH /:id/availability, POST|PATCH|DELETE /:id/menu/*)',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant to super-admin ------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug = 'super-admin'
  AND p.slug = 'restaurant.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant to the Restaurant Ops role -----------------------------------------
-- Food-ops staff already review onboarding and work dispatch for these same
-- merchants; storefront corrections (a wrong price, an unavailable dish, a store
-- that must be closed) are the same job. They still do NOT get payouts-process
-- or any finance slug.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug = 'restaurant-ops'
  AND p.slug = 'restaurant.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
