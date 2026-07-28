-- =============================================================================
-- RBAC seed gaps — Round 2 (additive)
-- The Round-1 fix (20260920000100) seeded 6 enforced-but-unseeded slugs. A proper
-- SQL-aware reconciliation of ALL enforced RequirePermission slugs vs ALL seeded
-- permissions found 7 more that are enforced by handlers but never seeded — so they
-- 403 for every non-wildcard admin wherever the module flag is on:
--   academy.assessment.review, academy.identity, connect.moderation.manage,
--   placement.admin.{approve,reject,review,suspend}
-- Seed them + grant to super-admin/system-admin, plus sibling-parity grants so
-- existing operators (who already hold the module's other perms) keep access.
-- =============================================================================

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Review Assessment',        'academy.assessment.review', 'academy',   'assessment', 'review',  'Review academy assessment submissions [enforced]',        true),
  ('Academy Identity',         'academy.identity',          'academy',   'identity',   'access',  'Academy identity/guardian admin surface [enforced]',      true),
  ('Manage Connect Moderation','connect.moderation.manage', 'connect',   'moderation', 'manage',  'Act on connect moderation cases (beyond review) [enforced]',true),
  ('Approve Placement',        'placement.admin.approve',   'placement', 'admin',      'approve', 'Approve a featured placement [enforced]',                 true),
  ('Reject Placement',         'placement.admin.reject',    'placement', 'admin',      'reject',  'Reject a featured placement [enforced]',                  true),
  ('Review Placement',         'placement.admin.review',    'placement', 'admin',      'review',  'Review the featured-placement queue [enforced]',          true),
  ('Suspend Placement',        'placement.admin.suspend',   'placement', 'admin',      'suspend', 'Suspend a live featured placement [enforced]',            true)
ON CONFLICT (slug) DO NOTHING;

-- Grant all 7 to the platform wildcard roles (safety net).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.slug IN ('super-admin', 'system-admin')
  AND p.slug IN (
    'academy.assessment.review', 'academy.identity', 'connect.moderation.manage',
    'placement.admin.approve', 'placement.admin.reject', 'placement.admin.review', 'placement.admin.suspend'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Sibling-parity: any role that can REVIEW connect moderation can also MANAGE it.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM public.role_permissions rp
JOIN public.permissions rev ON rev.id = rp.permission_id AND rev.slug = 'connect.moderation.review'
CROSS JOIN public.permissions p
WHERE p.slug = 'connect.moderation.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Sibling-parity: any role holding an academy assessment/identity-adjacent perm keeps
-- the new academy slugs (grant to holders of academy.assessment* / academy.* admin).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
FROM public.role_permissions rp
JOIN public.permissions sib ON sib.id = rp.permission_id AND sib.slug LIKE 'academy.%'
CROSS JOIN public.permissions p
WHERE p.slug IN ('academy.assessment.review', 'academy.identity')
  AND rp.role_id IN (SELECT id FROM public.roles WHERE slug IN ('platform-edtech-admin'))
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
