-- Paymax Connect — refund permission (PAY-007)
-- Ref: Spotlight_Connect_Test_Plan TS-8 PAY-007 (refund safe & single).
--
-- Seeds the RBAC permission that gates POST /api/connect/admin/orders/:id/refund
-- and grants it to the same admin roles that already hold connect.payments.reconcile.
-- Additive-only: INSERT ... ON CONFLICT DO NOTHING; no existing rows changed.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Refund Connect Payments', 'connect.payments.refund', 'connect', 'payment', 'refund',
   'Reverse a paid Connect order (safe, single, idempotent)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin and system-admin (mirrors connect.payments.reconcile).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.payments.refund')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.payments.refund')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
