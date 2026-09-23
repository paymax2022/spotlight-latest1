-- Contest Promotion — fix: seed the missing connect.contests.view permission.
--
-- 20270304150000_contest_promotion_rbac.sql seeded partners.manage /
-- promotions.request / promotions.approve, but three READ-ONLY routes in
-- promotion_handlers.go (RegisterPromotionAdmin) guard on
-- "connect.contests.view" — a slug that was never inserted into
-- public.permissions anywhere in this repo's migration history (confirmed by
-- grep across every migration). Since CheckPermission denies a grant that
-- doesn't exist, every admin — including super-admin — would get 403 on:
--   GET /connect/admin/contests/:id/children
--   GET /connect/admin/contest-promotions
--   GET /connect/admin/contest-promotions/:id
-- the moment FEATURE_CONTEST_PROMOTION_ENABLED is turned on. Found while
-- building the admin UI for this feature, before it ever shipped user-facing.
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Contest Hierarchy & Promotions', 'connect.contests.view', 'connect', 'contests', 'view',
   'Read-only: list a contest''s children and view pending/past promotion requests (enforced ListChildContests/ListPromotions/GetPromotion handlers)', true)
ON CONFLICT (slug) DO NOTHING;

-- Same role set as the write permissions seeded in 20270304150000, plus
-- 'judge' (already holds connect.contests.judge from 20261231000000, a
-- reasonable read-adjacent role for this feature).
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.contests.view')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin', 'contest-manager', 'judge')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
