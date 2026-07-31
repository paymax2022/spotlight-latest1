-- Paymax Marketplace — RBAC permission seed for the Appeals admin console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the
-- appeals review/decide slugs the appeals console gates on and the backend
-- guard("marketplace.admin.appeals.*") will enforce. Overturning a policy action
-- is maker-checker: the second-approver step reuses the appeals.decide grant so a
-- DIFFERENT admin can complete it (SAME_APPROVER_NOT_ALLOWED enforced server-side).
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Review Marketplace Appeals', 'marketplace.admin.appeals.review', 'marketplace', 'appeals', 'review',
   'View the Marketplace appeals queue and appellant evidence (GET /admin/appeals/*)', true),
  ('Decide Marketplace Appeals', 'marketplace.admin.appeals.decide', 'marketplace', 'appeals', 'decide',
   'Uphold or overturn a Marketplace moderation appeal; second-sign an overturn (reason_code mandatory)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant both to super-admin + system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.appeals.review','marketplace.admin.appeals.decide'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.appeals.review','marketplace.admin.appeals.decide'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Trust & Fraud Desk (marketplace-fraud-ops) works the appeals queue too.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('marketplace.admin.appeals.review','marketplace.admin.appeals.decide'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'marketplace-fraud-ops'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
