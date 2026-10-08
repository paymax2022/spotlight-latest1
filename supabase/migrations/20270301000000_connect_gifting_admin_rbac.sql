-- CONNECT-001 (P0 blocker): admin gifting read surface (gift-transactions
-- ledger). Additive-only — new permission, no DROP/rename/narrowing.
--
-- Mirrors the connect.aml.view grant pattern (20260704000000_connect_money.sql):
-- super-admin + system-admin get full visibility; connect-moderator gets the
-- same read-only visibility it already has for AML.
BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Gifting Ledger', 'connect.gifting.view', 'connect', 'gifting', 'view',
   'View the Connect gift-transactions admin ledger (read-only)', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.gifting.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.gifting.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.gifting.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
