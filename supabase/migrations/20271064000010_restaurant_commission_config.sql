-- FOOD-UAT-F-003: admin-editable food-delivery commission split. Additive-only.
-- Replaces the hard-coded 80/10/10 (restaurant/rider/platform) in
-- restaurant.Service.settleOrder with a resolvable config: a restaurant-specific
-- row wins, else the single global default row (restaurant_id IS NULL).
-- Splits are basis points and MUST sum to 10000. Guard on the admin routes:
--   RequirePermission(rbac, "restaurant.admin.commission")
BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_commission_config (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID REFERENCES public.restaurants(id) ON DELETE CASCADE, -- NULL = global default
    provider_split_bps  INTEGER NOT NULL CHECK (provider_split_bps >= 0),
    rider_split_bps     INTEGER NOT NULL CHECK (rider_split_bps >= 0),
    platform_split_bps  INTEGER NOT NULL CHECK (platform_split_bps >= 0),
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT restaurant_commission_config_sums_to_10000
        CHECK (provider_split_bps + rider_split_bps + platform_split_bps = 10000)
);

-- One row per restaurant, and exactly one global row.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_commission_config_one_per_scope
    ON public.restaurant_commission_config ((COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)));

INSERT INTO public.restaurant_commission_config (restaurant_id, provider_split_bps, rider_split_bps, platform_split_bps)
VALUES (NULL, 8000, 1000, 1000)
ON CONFLICT DO NOTHING;

ALTER TABLE public.restaurant_commission_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES ('Manage Restaurant Commission', 'restaurant.admin.commission', 'restaurant', 'commission', 'manage',
        'View/edit the food-delivery commission split (/restaurant/admin/commission)', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin')
   AND p.slug = 'restaurant.admin.commission'
ON CONFLICT (role_id, permission_id) DO NOTHING;
COMMIT;
