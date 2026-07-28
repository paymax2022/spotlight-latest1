-- Paymax super-app — RBAC seed-gap backfill (enforced-but-unseeded slugs)
-- Ref: docs/qa/admin-rbac.md (§Aggregate P0/P1), docs/go-live-readiness.md (blocker #5),
--      20260919000000_estate_admin_rbac.sql / 20260918000100_academy_fees_integration.sql
--      (seed shape mirrored below).
--
-- WHY THIS MIGRATION
-- Six permission slugs are ENFORCED at the route layer via
-- middleware.RequirePermission(rbac, "<slug>") but were NEVER seeded in any
-- migration. Because public.user_has_permission (20260527100000_enterprise_auth_rbac.sql)
-- only hard-returns TRUE for 'super-admin', every one of these consoles currently
-- 403s for every non-super-admin operator — and the permission row does not even
-- exist to be granted to an operator role. Enforced-but-unseeded slugs backfilled:
--
--   finance.admin.transfers   (finance_routes.go:275-279  — Transfers admin console)
--   finance.admin.kyc         (finance_routes.go:760-766  — KYC-verify admin console)
--   restaurant.admin.pricing  (finance_routes.go:1251-1252 — Delivery-fee console)
--   spotlight.admin.manage    (spotlightwealth_routes.go:49 — Spotlight Wealth admin)
--   learn.admin.manage        (learn_routes.go:43          — Learn/EdTech content admin)
--   maps:metrics:read         (maps/handler.go:412         — Maps usage metrics)
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING — no existing row is
-- modified, no DROP/rename/type-narrowing. Re-runnable.
--
-- module/resource/action are parsed from each slug. Two slug styles are present:
-- dot-delimited (module.resource.action) and colon-delimited (maps:metrics:read);
-- the slug string itself is preserved verbatim so it matches the guard() call.
--
-- ROLE MAPPING (grant to super-admin + system-admin unconditionally, plus the most
-- appropriate existing operator role where one exists):
--   finance.admin.transfers / finance.admin.kyc → super-admin + system-admin only
--     (no dedicated finance-ops/compliance platform role exists to grant to yet).
--   restaurant.admin.pricing → super-admin + system-admin + restaurant-ops
--     (20260919000200_restaurant_admin_rbac.sql).
--   learn.admin.manage → super-admin + system-admin + platform-edtech-admin
--     (20260918000100_academy_fees_integration.sql — the EdTech content operator).
--   spotlight.admin.manage → super-admin + system-admin only
--     (no dedicated content/wealth operator role exists yet).
--   maps:metrics:read → super-admin + system-admin only
--     (no dedicated ops/analytics operator role exists yet).

BEGIN;

-- 1. Seed the six enforced-but-unseeded permissions ----------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Admin Transfers Oversight', 'finance.admin.transfers',  'finance',    'transfers', 'admin',  'Admin transfers console: list, retry, reverse, provider health (enforced finance_routes.go:275-279)', true),
  ('Admin KYC-Verify Review',   'finance.admin.kyc',        'finance',    'kyc',       'admin',  'Admin KYC-verify review queue, case approve/reject, routing rules (enforced finance_routes.go:760-766)', true),
  ('Manage Delivery Pricing',   'restaurant.admin.pricing', 'restaurant', 'pricing',   'manage', 'Restaurant/food delivery-fee configuration console (enforced finance_routes.go:1251-1252)', true),
  ('Manage Spotlight Wealth',   'spotlight.admin.manage',   'spotlight',  'admin',     'manage', 'Spotlight Wealth admin surface: campaigns/config (enforced spotlightwealth_routes.go:49)', true),
  ('Manage Learn Content',      'learn.admin.manage',       'learn',      'admin',     'manage', 'Learn/EdTech content admin: glossary and content management (enforced learn_routes.go:43)', true),
  ('Read Maps Metrics',         'maps:metrics:read',        'maps',       'metrics',   'read',   'View Maps usage metrics (enforced maps/handler.go:412)', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant all six to super-admin (kept complete despite hard bypass) -----------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'finance.admin.transfers',
    'finance.admin.kyc',
    'restaurant.admin.pricing',
    'spotlight.admin.manage',
    'learn.admin.manage',
    'maps:metrics:read'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant all six to system-admin (platform administration operator) -----------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'finance.admin.transfers',
    'finance.admin.kyc',
    'restaurant.admin.pricing',
    'spotlight.admin.manage',
    'learn.admin.manage',
    'maps:metrics:read'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. restaurant.admin.pricing → restaurant-ops (food operations operator) -------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'restaurant.admin.pricing')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'restaurant-ops'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'restaurant-ops')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. learn.admin.manage → platform-edtech-admin (EdTech content operator) -------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'learn.admin.manage')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'platform-edtech-admin'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'platform-edtech-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
