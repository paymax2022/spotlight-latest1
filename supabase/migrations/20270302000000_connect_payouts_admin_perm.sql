-- Paymax Connect — payouts admin RBAC permissions (CONNECT-001)
--
-- backend/internal/connect/payouts had a member-facing POST/GET /payouts but
-- NO admin route group at all: no RegisterAdmin, no admin list/detail/settle/
-- reject. frontend-admin's payouts queue page therefore called endpoints that
-- 404'd in production (Connect isn't in the mock-allowlist, so
-- resolveUseMock() defaults the admin console to live). This migration seeds
-- the two RBAC permissions the new admin routes in
-- backend/internal/connect/payouts/handlers.go (RegisterAdmin) require:
--
--   connect.payouts.view   — GET  /api/connect/admin/payouts, /payouts/:id
--   connect.payouts.manage — POST /api/connect/admin/payouts/:id/settle
--                             POST /api/connect/admin/payouts/:id/reject
--
-- Additive-only: INSERT ... ON CONFLICT DO NOTHING; no existing rows changed.
-- Grants mirror the existing connect.payments.reconcile / connect.payments.refund
-- precedent (super-admin + system-admin).

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Payouts (admin)', 'connect.payouts.view', 'connect', 'payout', 'view',
   'List and inspect creator payout requests in the Connect admin console', true),
  ('Manage Connect Payouts (admin)', 'connect.payouts.manage', 'connect', 'payout', 'manage',
   'Confirm settlement or reject (reverse) a creator payout request', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.payouts.view', 'connect.payouts.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.payouts.view', 'connect.payouts.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
