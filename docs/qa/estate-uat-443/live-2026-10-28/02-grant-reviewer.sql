-- Local-dev RBAC grant so the Phase 2.5a lane can drive the platform review queue and the legal-hold
-- route over HTTP.
--
-- /api/finance/estate-admin/estates/* is guarded by middleware.RequirePermission("estate.admin.lifecycle")
-- which resolves through user_has_permission() -> effective_permissions(). The grant was created for the
-- Phase 2.3 lane and removed again at its teardown, so this lane re-applies it: Phase 2.5a needs it twice —
-- once to publish the estate its inbox rows hang off (pending -> active is the precondition for any
-- notification *write*), and once for POST /estate-admin/estates/:id/legal-hold, which is how the lane
-- puts the estate under hold and takes it out again without touching the estates table by hand.
--
-- Additive and reversible: NOT EXISTS-guarded so re-applying changes nothing, and the DELETE at the bottom
-- undoes exactly what this file adds (scope_id is NULL here, which a unique index does not de-duplicate).
-- Local stack only — never shared/staging.
BEGIN;

INSERT INTO user_permissions (user_id, permission_id, effect, scope_type, reason)
SELECT pu.id, p.id, 'allow', 'global',
       'estate UAT Phase 2.5a: drive the estate review queue and legal hold over HTTP (live-2026-10-28 lane)'
FROM platform_users pu
JOIN permissions p ON p.slug = 'estate.admin.lifecycle'
WHERE pu.email = 'estate-uat-admin@local.test'
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions e
    WHERE e.user_id = pu.id AND e.permission_id = p.id AND e.effect = 'allow' AND e.scope_type = 'global'
  );

COMMIT;

-- Proof the grant resolves (the exact call the middleware makes):
SELECT user_has_permission(pu.id, 'estate.admin.lifecycle') AS lifecycle_granted, pu.email
FROM platform_users pu WHERE pu.email = 'estate-uat-admin@local.test';

-- Undo (run by 09-teardown.sql):
--   DELETE FROM user_permissions up
--    USING permissions p, platform_users pu
--    WHERE up.permission_id = p.id AND up.user_id = pu.id
--      AND p.slug = 'estate.admin.lifecycle' AND pu.email = 'estate-uat-admin@local.test';
