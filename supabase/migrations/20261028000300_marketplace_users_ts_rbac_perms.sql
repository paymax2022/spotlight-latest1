-- Paymax Marketplace — RBAC permission seed for the Users / Trust & Safety console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the two
-- slugs the Users/T&S + Fraud consoles gate on; the backend
-- guard("marketplace.admin.users.*") will enforce on the /admin/users routes.
-- A ban is maker-checker: the second-approver step reuses the users.action grant
-- so a DIFFERENT admin can complete it (SAME_APPROVER_NOT_ALLOWED enforced server-side).
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Marketplace Users', 'marketplace.admin.users.view', 'marketplace', 'users', 'view',
   'Search users (PII masked) and view fraud signals (GET /admin/users, /admin/fraud-signals)', true),
  ('Action Marketplace Users', 'marketplace.admin.users.action', 'marketplace', 'users', 'action',
   'Suspend/ban/reinstate users, review KYC, blacklist identifiers, record audited view-as (reason_code mandatory; ban is maker-checker)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant both to super-admin + system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.users.view','marketplace.admin.users.action'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.users.view','marketplace.admin.users.action'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Trust & Fraud Desk (marketplace-fraud-ops) works the Users/T&S + Fraud consoles.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.users.view','marketplace.admin.users.action'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'marketplace-fraud-ops'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
