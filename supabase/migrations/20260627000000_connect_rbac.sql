-- Paymax Connect — RBAC permissions & roles (Phase 0)
-- Ref: docs/prd/dating/{architecture.md §26.2, compliance.md, PHASE-0-PLAN.md Q1}
--
-- Additive-only. Seeds connect.* permissions into the existing enterprise RBAC tables
-- (public.permissions / public.roles / public.role_permissions from
-- 20260527100000_enterprise_auth_rbac.sql) and grants them to admin roles.
-- No existing rows are modified; every write is ON CONFLICT DO NOTHING.
--
-- Notes:
--  * super-admin needs no explicit grant (public.user_has_permission bypasses for super-admin),
--    but we grant the full connect.* set anyway to keep its role_permissions complete/visible.
--  * A dedicated 'connect-moderator' role is introduced for safety/moderation staff.
--  * Permission slug/module/resource/action follow the convention in enterprise_auth_rbac.

BEGIN;

-- 1. Dedicated moderation role -------------------------------------------------
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Connect Moderator', 'connect-moderator',
   'Reviews Connect verification, profile/chat moderation, safety cases and underage flags',
   'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Connect permissions -------------------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect Audit Log',        'connect.audit.view',          'connect', 'audit',        'view',    'View Connect admin/audit log',                      true),
  ('View Connect Safety Cases',     'connect.cases.view',          'connect', 'case',         'view',    'View Connect safety cases',                         true),
  ('Manage Connect Safety Cases',   'connect.cases.manage',        'connect', 'case',         'manage',  'Assign, update and resolve Connect safety cases',   true),
  ('View Connect Moderation Queue', 'connect.moderation.view',     'connect', 'moderation',   'view',    'View Connect profile/chat moderation queues',       true),
  ('Review Connect Moderation',     'connect.moderation.review',   'connect', 'moderation',   'review',  'Act on Connect profile/chat moderation items',      true),
  ('View Connect Verification',     'connect.verification.view',   'connect', 'verification', 'view',    'View Connect verification review queue',            true),
  ('Review Connect Verification',   'connect.verification.review', 'connect', 'verification', 'review',  'Approve or reject Connect verification (L0-L1)',    true),
  ('Review Connect Underage Flags', 'connect.underage.review',     'connect', 'underage',     'review',  'Review suspected-minor queue (child-safety)',       true),
  ('View Connect Users',            'connect.users.view',          'connect', 'user',         'view',    'View Connect user management',                      true),
  ('View Connect Config',           'connect.config.view',         'connect', 'config',       'view',    'View backend-owned Connect config',                 true),
  ('Manage Connect Config',         'connect.config.manage',       'connect', 'config',       'manage',  'Edit flags, weights, limits, entitlements, rules',  true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Grant full connect.* to super-admin (kept complete despite bypass) --------
WITH p AS (SELECT id FROM public.permissions WHERE module = 'connect')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Grant full connect.* to system-admin (platform administration) ------------
WITH p AS (SELECT id FROM public.permissions WHERE module = 'connect')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. Grant operational subset to connect-moderator -----------------------------
--    (everything except platform-level config management)
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'connect.audit.view',
    'connect.cases.view',
    'connect.cases.manage',
    'connect.moderation.view',
    'connect.moderation.review',
    'connect.verification.view',
    'connect.verification.review',
    'connect.underage.review',
    'connect.users.view',
    'connect.config.view'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
