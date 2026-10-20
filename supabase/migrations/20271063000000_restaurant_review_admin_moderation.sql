-- FOOD-UAT-G-003: admin review moderation (list/hide/restore/flag). Additive-only.
-- Adds audit columns to restaurant_ratings and seeds restaurant.admin.reviews.
-- Guard: RequirePermission(rbac, "restaurant.admin.reviews") on
--   GET /api/restaurant/admin/reviews, POST /reviews/:id/{hide,restore,flag}.

BEGIN;

ALTER TABLE restaurant_ratings ADD COLUMN IF NOT EXISTS hidden_at     TIMESTAMPTZ;
ALTER TABLE restaurant_ratings ADD COLUMN IF NOT EXISTS hidden_by     UUID;
ALTER TABLE restaurant_ratings ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
ALTER TABLE restaurant_ratings ADD COLUMN IF NOT EXISTS flagged_at    TIMESTAMPTZ;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES ('Moderate Restaurant Reviews', 'restaurant.admin.reviews', 'restaurant', 'reviews', 'moderate',
        'List and moderate customer reviews (GET /restaurant/admin/reviews; POST /reviews/:id/hide|restore|flag)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin', 'restaurant-ops')
   AND p.slug = 'restaurant.admin.reviews'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
