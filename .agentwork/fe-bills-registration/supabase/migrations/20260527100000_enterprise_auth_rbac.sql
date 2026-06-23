BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  password_hash text,
  user_type text NOT NULL DEFAULT 'registered_user',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active','pending','suspended','locked','deleted')),
  profile_completed boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  referral_code text,
  referred_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  profile_type text NOT NULL,
  avatar_url text,
  bio text,
  country text,
  state text,
  city text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion_score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, profile_type)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text,
  role_type text NOT NULL DEFAULT 'system',
  is_system_role boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  module text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  description text,
  is_system_permission boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','program','contest','state','school','cohort','season')),
  scope_id text,
  assigned_by uuid,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  effect text NOT NULL CHECK (effect IN ('allow','deny')),
  scope_type text NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','program','contest','state','school','cohort','season')),
  scope_id text,
  reason text,
  assigned_by uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, permission_id, effect, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  device_info text,
  ip_address inet,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  module text NOT NULL,
  resource_type text,
  resource_id text,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  severity text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.login_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed')),
  failure_reason text,
  ip_address inet,
  user_agent text,
  location_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_active ON public.user_roles(user_id, is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_scope ON public.user_permissions(user_id, scope_type, scope_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_permissions_slug ON public.permissions(slug);
CREATE INDEX IF NOT EXISTS idx_roles_slug ON public.roles(slug);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

CREATE OR REPLACE FUNCTION public.effective_permissions(
  p_user_id uuid,
  p_scope_type text DEFAULT 'global',
  p_scope_id text DEFAULT NULL
)
RETURNS TABLE(permission_slug text)
LANGUAGE sql
STABLE
AS $$
WITH active_roles AS (
  SELECT ur.role_id
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND r.is_active = true
    AND (ur.starts_at IS NULL OR ur.starts_at <= now())
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
    AND (
      ur.scope_type = 'global'
      OR (ur.scope_type = p_scope_type AND (ur.scope_id IS NULL OR ur.scope_id = p_scope_id))
    )
),
role_perms AS (
  SELECT p.slug
  FROM active_roles ar
  JOIN public.role_permissions rp ON rp.role_id = ar.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
),
overrides AS (
  SELECT p.slug, up.effect
  FROM public.user_permissions up
  JOIN public.permissions p ON p.id = up.permission_id
  WHERE up.user_id = p_user_id
    AND (up.expires_at IS NULL OR up.expires_at > now())
    AND (
      up.scope_type = 'global'
      OR (up.scope_type = p_scope_type AND (up.scope_id IS NULL OR up.scope_id = p_scope_id))
    )
)
SELECT DISTINCT rp.slug
FROM role_perms rp
LEFT JOIN overrides d ON d.slug = rp.slug AND d.effect = 'deny'
WHERE d.slug IS NULL
UNION
SELECT DISTINCT o.slug FROM overrides o WHERE o.effect = 'allow';
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(
  p_user_id uuid,
  p_permission_slug text,
  p_scope_type text DEFAULT 'global',
  p_scope_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  is_super boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND r.is_active = true
      AND r.slug = 'super-admin'
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  ) INTO is_super;

  IF is_super THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.effective_permissions(p_user_id, p_scope_type, p_scope_id) ep
    WHERE ep.permission_slug = p_permission_slug
  );
END;
$$;

INSERT INTO public.roles(name, slug, description, role_type, is_system_role)
VALUES
('Super Admin', 'super-admin', 'System wide unrestricted control', 'system', true),
('System Admin', 'system-admin', 'Platform administration role', 'admin', true),
('Contest Manager', 'contest-manager', 'Manages assigned contests', 'program', true),
('State Coordinator', 'state-coordinator', 'State-level operations', 'program', true),
('Judge', 'judge', 'Contest scoring and judging', 'program', true),
('Contestant', 'contestant', 'Participant role', 'contestant', true),
('Sponsor Representative', 'sponsor-representative', 'Sponsor account role', 'partner', true),
('School Representative', 'school-representative', 'School account role', 'school', true),
('Registered User', 'registered-user', 'Default authenticated user role', 'public', true),
('Verified User', 'verified-user', 'Verified account role', 'public', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('View Users','users.view','users','account','view','Can view users',true),
('Edit Users','users.update','users','account','update','Can edit users',true),
('Suspend Users','users.suspend','users','account','suspend','Can suspend users',true),
('Assign Roles','users.roles.assign','users','roles','assign','Can assign roles',true),
('View Roles','roles.view','roles','role','view','Can view roles',true),
('Create Roles','roles.create','roles','role','create','Can create roles',true),
('Update Roles','roles.update','roles','role','update','Can update roles',true),
('Delete Roles','roles.delete','roles','role','delete','Can delete roles',true),
('Assign Permissions','permissions.assign','permissions','permission','assign','Can assign permissions',true),
('View Permissions','permissions.view','permissions','permission','view','Can view permissions',true),
('Delete Permissions','permissions.delete','permissions','permission','delete','Can delete custom permissions',true),
('Create Contest','contest.create','contest','contest','create','Can create contests',true),
('Update Contest','contest.update','contest','contest','update','Can update contests',true),
('Publish Contest','contest.publish','contest','contest','publish','Can publish contests',true),
('View Contestants','contestant.view','contestant','contestant','view','Can view contestants',true),
('Approve Contestants','contestant.approve','contestant','contestant','approve','Can approve contestants',true),
('Reject Contestants','contestant.reject','contestant','contestant','reject','Can reject contestants',true),
('Score Submissions','judge.score','judging','submission','score','Can score submissions',true),
('View Finance','finance.view','finance','ledger','view','Can view finance data',true),
('Process Refund','payments.refund','payments','refund','process','Can process refunds',true),
('View Audit Logs','audit.logs.view','audit','log','view','Can view audit logs',true),
('Export Audit Logs','audit.logs.export','audit','log','export','Can export audit logs',true),
('Override Voting Result','votes.override','votes','result','override','High risk voting override',true),
('View Own Profile','users.profile.view','users','profile','view','Can view own profile',true),
('Update Own Profile','users.profile.update','users','profile','update','Can update own profile',true)
ON CONFLICT (slug) DO NOTHING;

WITH r AS (SELECT id, slug FROM public.roles), p AS (SELECT id, slug FROM public.permissions)
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
WHERE r.slug = 'super-admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH sys_admin AS (SELECT id FROM public.roles WHERE slug = 'system-admin'),
perms AS (SELECT id, slug FROM public.permissions WHERE slug IN ('users.view','users.update','users.suspend','users.roles.assign','roles.view','roles.create','roles.update','permissions.view','permissions.assign','audit.logs.view'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT sys_admin.id, perms.id FROM sys_admin, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH contest_mgr AS (SELECT id FROM public.roles WHERE slug = 'contest-manager'),
perms AS (SELECT id FROM public.permissions WHERE slug IN ('contest.create','contest.update','contest.publish','contestant.view','contestant.approve','contestant.reject'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT contest_mgr.id, perms.id FROM contest_mgr, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH judge_role AS (SELECT id FROM public.roles WHERE slug = 'judge'),
perms AS (SELECT id FROM public.permissions WHERE slug IN ('judge.score','contestant.view'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT judge_role.id, perms.id FROM judge_role, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
