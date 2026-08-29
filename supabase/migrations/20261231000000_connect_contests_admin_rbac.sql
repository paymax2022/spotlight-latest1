-- Paymax super-app — seed connect.contests.manage / connect.contests.judge
-- Ref: backend/internal/connect/voting/handlers.go RegisterAdmin,
--      backend/internal/connect/voting/eviction_handlers.go
--      (mirrors 20260920000100_rbac_seed_gaps.sql's shape)
--
-- WHY THIS MIGRATION
-- Two permission slugs are ENFORCED at the route layer via
-- guard("connect.contests.manage") / guard("connect.contests.judge") on the
-- Connect voting admin routes (stage eviction trigger/extend/finalize,
-- unlimited admin-vote, judge contestant save) but were never seeded — the
-- rows didn't exist in public.permissions at all. super-admin already
-- bypasses via user_has_permission's hard-coded check (20260527100000), so
-- this was never a functional blocker for that role, but every other role —
-- including 'judge' and 'contest-manager', whose names are the obvious grant
-- targets — could never be granted these permissions because the rows never
-- existed to grant. Seeded now while wiring the admin-vote console to real
-- data (previously a hardcoded mock with no backend call at all).
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Contest Stage Evictions', 'connect.contests.manage', 'connect', 'contests', 'manage',
   'Trigger/extend/finalize stage evictions and cast unlimited admin votes (enforced handlers.go RegisterAdmin, eviction_handlers.go)', true),
  ('Judge Contest Save',             'connect.contests.judge',  'connect', 'contests', 'judge',
   'Judge/admin save of a contestant''s stage progression (enforced handlers.go RegisterAdmin SaveContestant)', true)
ON CONFLICT (slug) DO NOTHING;

-- super-admin + system-admin (platform administration operators)
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.contests.manage', 'connect.contests.judge'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM p, public.roles r WHERE r.slug IN ('super-admin', 'system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- connect.contests.manage → contest-manager (the obvious semantic owner)
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.contests.manage')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'contest-manager'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'contest-manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- connect.contests.judge → judge (the obvious semantic owner)
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.contests.judge')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'judge'), p.id FROM p
WHERE EXISTS (SELECT 1 FROM public.roles WHERE slug = 'judge')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
