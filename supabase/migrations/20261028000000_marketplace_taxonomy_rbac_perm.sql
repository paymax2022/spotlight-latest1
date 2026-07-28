-- Paymax Marketplace — RBAC permission seed for the Taxonomy admin console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the
-- single new slug `marketplace.admin.taxonomy` that the taxonomy CRUD console
-- (frontend-admin/app/admin/marketplace/taxonomy/*) gates on, and the backend
-- guard("marketplace.admin.taxonomy") will enforce on the category admin routes.
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.

BEGIN;

-- 1. New permission -----------------------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Marketplace Taxonomy', 'marketplace.admin.taxonomy', 'marketplace', 'taxonomy', 'manage',
   'Create/edit categories and their attribute schemas, risk tier, and commission (GET/POST/PUT /admin/categories)', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant to super-admin -----------------------------------------------------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.taxonomy')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant to system-admin ----------------------------------------------------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.taxonomy')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
