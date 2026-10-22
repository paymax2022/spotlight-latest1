-- FOOD-UAT-E-008: admin override for pickup/delivery code lockouts. Additive-only.
-- Guard: RequirePermission(rbac, "restaurant.admin.unlock_order_code") on
--   POST /api/restaurant/admin/orders/:orderId/unlock-codes.
BEGIN;
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES ('Unlock Order Codes', 'restaurant.admin.unlock_order_code', 'restaurant', 'order_code', 'unlock',
        'Clear pickup/delivery code lockouts on an order (POST /restaurant/admin/orders/:orderId/unlock-codes)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin', 'restaurant-ops')
   AND p.slug = 'restaurant.admin.unlock_order_code'
ON CONFLICT (role_id, permission_id) DO NOTHING;
COMMIT;
