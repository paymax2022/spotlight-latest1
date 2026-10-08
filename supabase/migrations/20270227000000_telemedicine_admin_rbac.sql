-- Telemedicine — TELEMEDICINE-004: RBAC seed for the admin console.
-- Additive-only (CLAUDE.md iron rule: no DROP, no renames, no type narrowing).
--
-- Mirrors the view/action split marketplace's Users/Trust & Safety console uses
-- (20261028000300_marketplace_users_ts_rbac_perms.sql): a read slug for the
-- dashboard/roster/appointment-list GETs, a separate action slug for the verify
-- decision (an MDCN approve/reject on doctor_verifications is a real state
-- change with an audit trail, not a read).
--
-- No telemedicine-specific ops role exists yet (grep of
-- `INSERT INTO public.roles` for 'telemedicine'/'doctor'/'health' turned up
-- only the unrelated health-provider-* capability roles), so both slugs are
-- granted to super-admin and system-admin only, matching every other admin
-- console's default posture before a dedicated ops role is introduced.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Telemedicine Admin Console', 'telemedicine.admin.view', 'telemedicine', 'admin', 'view',
   'Read the telemedicine admin dashboard, full doctor roster (incl. MDCN verification status), and system-wide appointment list (GET /api/v1/telemedicine/admin/*)', true),
  ('Manage Telemedicine Admin Console', 'telemedicine.admin.manage', 'telemedicine', 'admin', 'manage',
   'Approve/reject a doctor''s MDCN verification (POST /api/v1/telemedicine/admin/doctors/:userId/verify)', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('telemedicine.admin.view','telemedicine.admin.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('telemedicine.admin.view','telemedicine.admin.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
