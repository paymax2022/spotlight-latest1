-- Paymax Marketplace — RBAC permission seed for the Analytics admin console.
-- Additive-only, mirrors 20260905000001_marketplace_rbac_perms.sql. Adds the
-- single new slug `marketplace.admin.analytics` that the analytics dashboard
-- (frontend-admin/app/admin/marketplace/analytics) gates on, and the backend
-- guard("marketplace.admin.analytics") will enforce on GET /admin/analytics.
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Marketplace Analytics', 'marketplace.admin.analytics', 'marketplace', 'analytics', 'view',
   'View the Marketplace analytics dashboard: GMV, revenue, DAU, and the discovery→contact→deal funnel (GET /admin/analytics)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin + system-admin (platform administration).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.analytics')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.analytics')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Also grant to marketplace-fraud-ops (the Trust & Fraud Desk watches volume/funnel
-- health alongside the moderation queues).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'marketplace.admin.analytics')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'marketplace-fraud-ops'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
