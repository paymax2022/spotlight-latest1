-- FOOD-UAT-F-002: two-tier dispute-refund approval. Additive-only.
-- Refunds at or below threshold_kobo auto-approve under the base
-- restaurant.admin.disputes permission; refunds ABOVE it additionally require
-- restaurant.admin.refund_large. Latest row with effective_from <= now() wins.
BEGIN;

CREATE TABLE IF NOT EXISTS public.refund_tier_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    threshold_kobo  BIGINT NOT NULL CHECK (threshold_kobo >= 0),
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default: NGN 5,000 = 500000 kobo. Seed only when the table is empty.
INSERT INTO public.refund_tier_config (threshold_kobo)
SELECT 500000 WHERE NOT EXISTS (SELECT 1 FROM public.refund_tier_config);

ALTER TABLE public.refund_tier_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES ('Approve Large Food Refunds', 'restaurant.admin.refund_large', 'restaurant', 'refund', 'approve_large',
        'Resolve a food dispute with a refund above the refund_tier_config threshold', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r, public.permissions p
 WHERE r.slug IN ('super-admin', 'system-admin', 'finance-admin')
   AND p.slug = 'restaurant.admin.refund_large'
ON CONFLICT (role_id, permission_id) DO NOTHING;
COMMIT;
