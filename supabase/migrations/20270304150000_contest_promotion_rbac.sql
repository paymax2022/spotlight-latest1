-- Contest Promotion Phase 1 (6/6) — seed RBAC permissions for the new admin
-- routes (backend/internal/connect/voting: partner CRUD, promotion
-- request/approve/reject). Mirrors 20261231000000_connect_contests_admin_rbac.sql's
-- shape and naming convention exactly: slug = '<module>.<resource>.<sub>.<action>',
-- module='connect', resource='contests'.
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Contest Partners', 'connect.contests.partners.manage', 'connect', 'contests', 'manage',
   'Create/list/update partner organisations that run child contests (enforced Partner CRUD handlers)', true),
  ('Request Contest Promotion', 'connect.contests.promotions.request', 'connect', 'contests', 'request',
   'Request promotion of a child contest''s top-N contestants into its parent contest (enforced RequestPromotion handler)', true),
  ('Approve Contest Promotion', 'connect.contests.promotions.approve', 'connect', 'contests', 'approve',
   'Approve or reject a pending contest promotion request — must be a different admin than the requester (enforced ApprovePromotion/RejectPromotion handlers)', true)
ON CONFLICT (slug) DO NOTHING;

-- super-admin + system-admin (platform administration operators) get all three.
WITH p AS (
  SELECT id FROM public.permissions
   WHERE slug IN ('connect.contests.partners.manage', 'connect.contests.promotions.request', 'connect.contests.promotions.approve')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- contest-manager (the obvious semantic owner, same role already granted
-- connect.contests.manage in 20261231000000) gets partner management and can
-- request promotions, but NOT approve them — approval requires a second,
-- distinct admin by design (maker-checker), so it is deliberately withheld
-- from the role that already holds "request" to avoid a single role being
-- able to self-serve both sides in practice (the DB CHECK still enforces the
-- hard rule per-row regardless of role grants).
WITH p AS (
  SELECT id FROM public.permissions
   WHERE slug IN ('connect.contests.partners.manage', 'connect.contests.promotions.request')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'contest-manager'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'contest-manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
