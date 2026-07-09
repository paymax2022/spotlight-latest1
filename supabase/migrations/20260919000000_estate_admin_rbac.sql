-- Paymax Estate super-app — PLATFORM admin oversight RBAC seed
-- Ref: backend/internal/app/estate_admin_routes.go (guard("estate.admin.*")),
--      20260627000000_connect_rbac.sql (seed shape mirrored below),
--      20260905000001_marketplace_rbac_perms.sql (admin.* namespace precedent).
--
-- Additive-only. Seeds estate.admin.* permissions into the existing enterprise
-- RBAC tables (public.permissions / public.roles / public.role_permissions from
-- 20260527100000_enterprise_auth_rbac.sql) and grants them to admin roles.
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.
--
-- WHY THESE SLUGS
-- The estate module already ships `estate`, `estate_admin` and `estate_security`
-- role/scope concepts at the PER-ESTATE membership layer (estate_residents.role),
-- but had NO platform-level `estate.admin.*` permission namespace and NO backend
-- /admin route group. The Go registrar RegisterEstateAdmin guards each read-only
-- oversight route with one of the five slugs below; the slugs MUST match the
-- guard(...) calls verbatim or every admin request fails closed.
--
-- Naming convention (matches connect.*/marketplace.admin.*):
-- slug = module.resource.action, module = 'estate'.
--
-- A dedicated 'estate-admin' platform role is introduced for estate operations
-- HQ staff who work these oversight queues but should NOT get full super-admin.

BEGIN;

-- 1. Dedicated platform Estate Admin role --------------------------------------
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Estate Admin', 'estate-admin',
   'Estate operations HQ: platform oversight of estate security, dues reconciliation, ops queues, content and elections',
   'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Estate admin oversight permissions ----------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Estate Security Oversight', 'estate.admin.security', 'estate', 'security', 'view', 'View cross-estate guard posts, incidents, guard roster, visitor logs and emergencies (GET /estate-admin/security/*)', true),
  ('View Estate Dues Reconciliation','estate.admin.dues',     'estate', 'dues',     'view', 'View cross-estate dues reconciliation, invoices, payments and restrictions (GET /estate-admin/dues/*)',              true),
  ('View Estate Ops Queues',         'estate.admin.ops',      'estate', 'ops',      'view', 'View cross-estate ops queues: repairs, tasks, meetings, facilities (GET /estate-admin/ops/*)',                        true),
  ('View Estate Content',            'estate.admin.content',  'estate', 'content',  'view', 'View cross-estate announcements and documents (GET /estate-admin/content/*)',                                       true),
  ('View Estate Election Integrity', 'estate.admin.election', 'estate', 'election', 'view', 'View cross-estate election list, results and integrity audit (GET /estate-admin/elections/*)',                      true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Grant full estate.admin.* to super-admin (kept complete despite bypass) ---
WITH p AS (SELECT id FROM public.permissions WHERE module = 'estate')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Grant full estate.admin.* to system-admin (platform administration) -------
WITH p AS (SELECT id FROM public.permissions WHERE module = 'estate')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. Grant the full oversight set to the dedicated estate-admin role ------------
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'estate.admin.security',
    'estate.admin.dues',
    'estate.admin.ops',
    'estate.admin.content',
    'estate.admin.election'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'estate-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
