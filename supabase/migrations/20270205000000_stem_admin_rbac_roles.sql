-- Paymax STEM admin console — seed the real RBAC roles RequireStemRoles needs
-- Ref: ADR-056 (docs/adr/ADR-056-stem-role-real-rbac.md),
--      backend/internal/middleware/stem_authz.go RequireStemRoles,
--      backend/internal/middleware/admin_console_rbac.go (RequireAdminConsoleRole,
--        the reference pattern this follow-up mirrors),
--      backend/internal/app/router.go stemRead/stemManage allow-lists,
--      20260527100000_enterprise_auth_rbac.sql (role seed shape mirrored below),
--      20261231000000_connect_contests_admin_rbac.sql (STEM's sibling contest
--        module — permission-seed shape, not roles; unrelated to this file).
--
-- AUTH-020 follow-up. RequireStemRoles previously trusted a client-supplied
-- x-stem-role header as sole proof of WHICH STEM sub-role an already-verified
-- admin (RequireAdminConsoleRole having run first) actually holds — the header
-- narrowed a real identity but was never itself checked against anything real.
-- stem_authz.go now resolves the caller's REAL roles via rbac.GetUserRoles(
-- userID), same as RequireAdminConsoleRole, and the header is gone. But of the
-- seven STEM role names router.go allow-lists (SUPER_ADMIN, ADMIN,
-- OPERATIONS_MANAGER, CONTEST_MANAGER, SCHOOL_ADMIN, TEACHER_COACH, JUDGE,
-- MENTOR, SPONSOR), only three had a real public.roles row to resolve to:
--   SUPER_ADMIN    -> 'super-admin'    (20260527100000)
--   ADMIN          -> 'system-admin'   (20260527100000; stem_authz.go aliases
--                                        this slug to ADMIN — see its comment)
--   CONTEST_MANAGER-> 'contest-manager'(20260527100000)
--   JUDGE          -> 'judge'          (20260527100000)
-- This migration adds the five that had none: OPERATIONS_MANAGER,
-- SCHOOL_ADMIN, TEACHER_COACH, MENTOR, SPONSOR. (Note: 'school-representative'
-- and 'sponsor-representative' already exist in public.roles, but those are a
-- school's/sponsor's OWN external account role, not STEM admin-console staff —
-- reusing them here would grant console access to external account holders,
-- so this seeds distinct slugs instead.)
--
-- Slug -> STEM role-name mapping is a straight kebab-case -> UPPER_SNAKE
-- conversion (stem_authz.go's normalizeStemRoleSlug), so the slug spelling
-- below is load-bearing: 'operations-manager' must produce exactly
-- OPERATIONS_MANAGER, etc.
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING. No DROP, no RENAME,
-- no type narrowing.
--
-- Deliberately NOT included: assigning these roles to specific STEM staff
-- accounts. This migration ships to every environment (dev/staging/prod)
-- alike and has no legitimate way to know which real user IDs are STEM staff
-- in each. Every sibling *_rbac.sql migration in this repo (e.g.
-- 20260919000200_restaurant_admin_rbac.sql's 'restaurant-ops' role) seeds
-- roles/permissions only and leaves user assignment to the existing
-- operational flow: POST /api/admin/users/:id/roles (AssignRoleToUser,
-- already gated behind the users.roles.assign permission) via the admin
-- console, once a STEM staff member's account is known.

BEGIN;

INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('STEM Operations Manager', 'operations-manager',
   'STEM admin console: full read + manage across schools, contests, judging, bootcamp and awards (maps to OPERATIONS_MANAGER)',
   'admin', true),
  ('STEM School Admin', 'school-admin',
   'STEM admin console: read-only access to school/team/profile data (maps to SCHOOL_ADMIN)',
   'program', true),
  ('STEM Teacher/Coach', 'teacher-coach',
   'STEM admin console: read-only access for teachers and team coaches (maps to TEACHER_COACH)',
   'program', true),
  ('STEM Mentor', 'mentor',
   'STEM admin console: read-only access for programme mentors (maps to MENTOR)',
   'program', true),
  ('STEM Sponsor', 'sponsor',
   'STEM admin console: read-only access for contest sponsors (maps to SPONSOR)',
   'program', true)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
