-- Paymax super-app — seed connect.contests.view (the admin contest-list guard)
-- Ref: backend/internal/connect/voting/handlers.go RegisterAdmin / ListContestsAdmin
--      (mirrors 20261231000000_connect_contests_admin_rbac.sql's shape)
--
-- WHY THIS MIGRATION
-- GET /api/connect/admin/contests (ListContestsAdmin, the admin console's
-- competitions list, served on main since #848 and on prod since #1068) and
-- the two eviction READ routes are guarded by guard("connect.contests.view") —
-- but that slug was seeded nowhere: 20261231000000 created only manage/judge.
-- super-admin passes via user_has_permission's hard-coded bypass, so the owner
-- never noticed, but a scoped contest-manager could never be granted the
-- permission the guard demands: the row didn't exist to grant, so every
-- non-super-admin caller of the admin contest list got 403.
--
-- The judge role is deliberately NOT granted: its console reads contestants
-- through the member endpoint
-- (/api/v1/connect/contests/:id/stages/:n/contestants), which carries
-- authentication but no RBAC — judge already holds connect.contests.judge for
-- its save route.
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Contest Admin Console', 'connect.contests.view', 'connect', 'contests', 'view',
   'Read the admin contests list and the eviction/stage view routes (enforced handlers.go RegisterAdmin, ListContestsAdmin)', true)
ON CONFLICT (slug) DO NOTHING;

-- super-admin + system-admin (platform administration operators)
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.contests.view')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- connect.contests.view → contest-manager (the semantic owner of the console list)
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.contests.view')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'contest-manager'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'contest-manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
