-- FOOD-UAT-G-006 / G-007: RBAC permissions for the read-only admin order trace
-- and the GMV / net-revenue / cohort reports. Additive-only (data seed, no DDL).
--   GET /api/restaurant/admin/orders/:id/trace        -> restaurant.admin.trace
--   GET /api/restaurant/admin/reports/*               -> restaurant.admin.reports
BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Restaurant Order Trace', 'restaurant.admin.trace', 'restaurant', 'order_trace', 'read',
   'Read the chronological event history of a food order (/restaurant/admin/orders/:id/trace)', true),
  ('View Restaurant Reports', 'restaurant.admin.reports', 'restaurant', 'reports', 'read',
   'Read GMV / net-revenue / cohort reports and CSV exports (/restaurant/admin/reports)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin')
   AND p.slug IN ('restaurant.admin.trace', 'restaurant.admin.reports')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
