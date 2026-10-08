-- Paymax Restaurant/Food — merchant WITHDRAWAL ops RBAC seed (FOOD-005)
-- Ref: backend/internal/app/finance_routes.go (restAdmin group,
--        RequirePermission(rbac, "restaurant.admin.withdrawals")),
--      20260919000200_restaurant_admin_rbac.sql (seed shape mirrored below).
--
-- Additive-only. Seeds ONE new permission into the existing enterprise RBAC
-- tables and grants it to the same three roles the sibling restaurant.admin.*
-- permissions already went to. Every write is ON CONFLICT DO NOTHING — no
-- existing rows are modified. No DROP, no RENAME, no type narrowing.
--
-- WHY A DEDICATED SLUG
-- The withdrawal ops queue (GET .../withdrawals, GET .../withdrawals/:id,
-- POST .../withdrawals/:id/paid, POST .../withdrawals/:id/failed) is a distinct
-- money-path surface from restaurant.admin.payouts: payouts pay a provider FROM
-- the platform's settlement account INTO their wallet; withdrawals move money
-- OUT of that wallet to the provider's bank. An ops agent reviewing outbound
-- bank withdrawals should not need the broader restaurant.manage grant, and
-- should be grantable independently of payout-run reconciliation access.
--
-- Naming convention (matches restaurant.admin.payouts/disputes/etc.):
-- slug = module.resource.action, module = 'restaurant'.

BEGIN;

-- 1. New permission ------------------------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Restaurant Withdrawals', 'restaurant.admin.withdrawals', 'restaurant', 'withdrawals', 'manage',
   'View merchant/rider withdrawal requests and mark them paid or failed (GET /restaurant/admin/withdrawals[/:id]; POST /withdrawals/:id/{paid,failed})',
   true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant to super-admin -------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'),
       (SELECT id FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'super-admin')
  AND EXISTS (SELECT 1 FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant to system-admin -------------------------------------------------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'),
       (SELECT id FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'system-admin')
  AND EXISTS (SELECT 1 FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Grant to the dedicated restaurant-ops role (see 20260919000200) ------------
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'restaurant-ops'),
       (SELECT id FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'restaurant-ops')
  AND EXISTS (SELECT 1 FROM public.permissions WHERE slug = 'restaurant.admin.withdrawals')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
