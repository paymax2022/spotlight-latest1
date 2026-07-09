-- Paymax Restaurant/Food — PLATFORM admin ops RBAC seed
-- Ref: backend/internal/app/finance_routes.go (restAdmin group,
--        RequirePermission(rbac, "restaurant.admin.*")),
--      20260919000000_estate_admin_rbac.sql (seed shape mirrored below),
--      20260619000000_merchant_onboarding.sql (onboarding.review precedent).
--
-- Additive-only. Seeds the restaurant.admin.* ops permissions into the existing
-- enterprise RBAC tables (public.permissions / public.roles /
-- public.role_permissions from 20260527100000_enterprise_auth_rbac.sql) and
-- grants them to admin roles. Every write is ON CONFLICT DO NOTHING — no existing
-- rows are modified. No DROP, no RENAME, no type narrowing.
--
-- WHY THESE SLUGS
-- The restaurant module already ships `restaurant.manage` (broad manage) and
-- `restaurant.admin.pricing` (delivery-fee console). The new ops-console surfaces
-- — dispatch board, onboarding/KYC review, payout reconciliation, and the food
-- disputes view — each need a dedicated, least-privilege slug so ops staff can be
-- granted one queue without the others. The Go registrar guards each admin route
-- with RequirePermission(rbac, "restaurant.admin.<x>"); the slug MUST match the
-- guard verbatim or the request fails closed.
--
--   restaurant.admin.dispatch   → GET /api/restaurant/admin/riders,
--                                  GET /api/restaurant/admin/dispatch/queue,
--                                  POST /api/restaurant/admin/orders/:id/assign
--   restaurant.admin.onboarding → GET /api/restaurant/admin/onboarding,
--                                  POST /api/restaurant/admin/onboarding/:id/:decision
--   restaurant.admin.payouts    → GET /api/restaurant/admin/payouts (read-only recon)
--   restaurant.admin.disputes   → (no new backend route) gates the food disputes
--                                  console view, which REUSES the existing
--                                  /api/finance/{disputes, admin/disputes/:id/resolve}.
--
-- Naming convention (matches estate.admin.*/marketplace.admin.*):
-- slug = module.resource.action, module = 'restaurant'.
--
-- A dedicated 'restaurant-ops' platform role is introduced for food operations
-- staff who work these queues but should NOT get full super-admin.

BEGIN;

-- 1. Dedicated platform Restaurant Ops role ------------------------------------
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Restaurant Ops', 'restaurant-ops',
   'Food & delivery operations: dispatch board, merchant onboarding/KYC review, payout reconciliation and food disputes',
   'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Restaurant admin ops permissions ------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Restaurant Dispatch',   'restaurant.admin.dispatch',   'restaurant', 'dispatch',   'manage', 'View the rider roster + dispatch queue and manually assign riders (GET /restaurant/admin/riders, /dispatch/queue; POST /orders/:id/assign)', true),
  ('Review Restaurant Onboarding', 'restaurant.admin.onboarding', 'restaurant', 'onboarding', 'review', 'Review restaurant merchant onboarding/KYC and approve/reject (GET /restaurant/admin/onboarding; POST /onboarding/:id/:decision)',                true),
  ('View Restaurant Payouts',      'restaurant.admin.payouts',    'restaurant', 'payouts',    'view',   'View restaurant + rider payout reconciliation (read-only) (GET /restaurant/admin/payouts)',                                                     true),
  ('Resolve Restaurant Disputes',  'restaurant.admin.disputes',   'restaurant', 'disputes',   'resolve','Work the food disputes queue; resolution reuses the finance dispute routes (GET /finance/disputes, POST /finance/admin/disputes/:id/resolve)', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Grant the full restaurant.admin.* set to super-admin ----------------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'restaurant.admin.dispatch',
    'restaurant.admin.onboarding',
    'restaurant.admin.payouts',
    'restaurant.admin.disputes'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Grant the full set to system-admin (platform administration) --------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'restaurant.admin.dispatch',
    'restaurant.admin.onboarding',
    'restaurant.admin.payouts',
    'restaurant.admin.disputes'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. Grant the full ops set to the dedicated restaurant-ops role ---------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'restaurant.admin.dispatch',
    'restaurant.admin.onboarding',
    'restaurant.admin.payouts',
    'restaurant.admin.disputes'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'restaurant-ops'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
