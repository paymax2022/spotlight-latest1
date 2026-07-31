-- Paymax Marketplace — RBAC permission seed for the Pricing & Monetisation console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the single
-- slug the pricing console gates on; the backend guard("marketplace.admin.pricing")
-- will enforce on the boost-package / commission / discount-code / featured-slot
-- config routes. Every write is ON CONFLICT DO NOTHING — no existing rows modified.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Marketplace Pricing', 'marketplace.admin.pricing', 'marketplace', 'pricing', 'manage',
   'Edit boost packages, platform commission, discount codes, and featured-slot inventory (applies to new purchases only; audited)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin + system-admin (platform administration).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.pricing')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.pricing')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
