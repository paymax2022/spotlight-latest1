-- Local-dev RBAC grant so the Phase 2.3 lane can drive the platform review queue over HTTP.
--
-- /api/finance/estate-admin/estates/* is guarded by middleware.RequirePermission("estate.admin.lifecycle")
-- which resolves through user_has_permission() -> effective_permissions(). No user in this database
-- holds any estate.admin.* grant, so the reviewer routes could only be exercised in Go before this.
--
-- Additive and reversible: NOT EXISTS-guarded so re-applying changes nothing, and the DELETE at the
-- bottom undoes exactly what this file adds. (scope_id is NULL here, which a unique index does not
-- de-duplicate, hence NOT EXISTS rather than ON CONFLICT.) Local stack only — never shared/staging.
BEGIN;

INSERT INTO user_permissions (user_id, permission_id, effect, scope_type, reason)
SELECT pu.id, p.id, 'allow', 'global',
       'estate UAT Phase 2.3: drive the estate lifecycle review queue over HTTP (live-2026-10-27 lane)'
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

-- Undo:
--   DELETE FROM user_permissions up
--    USING permissions p, platform_users pu
--    WHERE up.permission_id = p.id AND up.user_id = pu.id
--      AND p.slug = 'estate.admin.lifecycle' AND pu.email = 'estate-uat-admin@local.test';
