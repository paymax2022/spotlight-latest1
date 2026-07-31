-- Paymax Marketplace — RBAC permission seed for the CMS & Banners console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the single
-- slug the CMS console gates on; the backend guard("marketplace.admin.cms") will
-- enforce on the /admin/banners and /admin/categories/:id/content routes.
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Marketplace CMS', 'marketplace.admin.cms', 'marketplace', 'cms', 'manage',
   'Manage home banners (scheduled) and per-category landing/SEO content (audited)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin + system-admin (platform administration).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.cms')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.cms')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
