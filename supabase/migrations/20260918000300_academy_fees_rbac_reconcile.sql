-- =============================================================================
-- EdTech School-Fees — RBAC reconciliation (additive)
-- Closes two gaps found reconciling backend enforcement vs the admin console:
--   1. academy.fees.hardship.review is ENFORCED by the hardship admin handler
--      (RequirePermission) but was never seeded — without it the hardship review
--      queue 403s for every role. Seed it + grant it.
--   2. The school-admin console nav gates three modules (Setup Wizard, Bulk
--      Onboarding, Collections) that had no backend permission. Seed them as
--      console-access permissions so nav visibility maps to a real granted perm.
-- Grants follow the same role model as 20260918000100:
--   school-owner + head-teacher → all four; bursar → day-to-day ops (onboarding,
--   collections, hardship.review) but NOT setup; super-admin + platform-edtech-admin
--   → everything (kept complete/visible even though they bypass).
-- =============================================================================

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Review Hardship',       'academy.fees.hardship.review', 'academy', 'hardship',    'review', 'Approve/deny hardship freeze requests (SF-9) [enforced]',        true),
  ('Fees Setup Wizard',     'academy.fees.setup',           'academy', 'setup',       'manage', 'School/session/class/fee-schedule setup wizard (SC-29)',         true),
  ('Fees Bulk Onboarding',  'academy.fees.onboarding',      'academy', 'onboarding',  'manage', 'Bulk student onboarding + approval queue (SC-32)',               true),
  ('Fees Collections View', 'academy.fees.collections',     'academy', 'collections', 'view',   'Collections dashboard (SC-33)',                                  true)
ON CONFLICT (slug) DO NOTHING;

-- super-admin + platform-edtech-admin: everything (complete/visible).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.slug IN ('super-admin', 'platform-edtech-admin')
  AND p.slug IN ('academy.fees.hardship.review', 'academy.fees.setup', 'academy.fees.onboarding', 'academy.fees.collections')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- school-owner + head-teacher: full school-admin fees surface.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.slug IN ('school-owner', 'head-teacher')
  AND p.slug IN ('academy.fees.hardship.review', 'academy.fees.setup', 'academy.fees.onboarding', 'academy.fees.collections')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- bursar: day-to-day money ops, NOT structural setup.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.slug = 'bursar'
  AND p.slug IN ('academy.fees.hardship.review', 'academy.fees.onboarding', 'academy.fees.collections')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
