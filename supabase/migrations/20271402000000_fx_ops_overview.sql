-- Read permission for the FX orchestration overview endpoint.
--
-- WHY
-- GET /api/finance/admin/fx/overview (backend/internal/orchestration/admin_overview.go)
-- is the first real admin route behind the FX console: it aggregates the
-- orchestration ledger (orch_conversions / orch_transfers / orch_collection_events)
-- plus the live treasury snapshot into the console's 24h headline.
--
-- It deliberately does NOT reuse finance.admin.fx_markup. That grant authorises
-- CHANGING what every customer pays on FX; reading volume, margin and float health
-- is a strictly weaker, read-only capability. Reusing the write permission would
-- force every future ops/analyst role to also hold the pricing-write grant.
--
-- SAFETY: additive-only — INSERT ... ON CONFLICT DO NOTHING only. No DROP, no
-- RENAME, no existing row modified. Re-runnable.

BEGIN;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES (
  'View FX Operations Overview',
  'finance.admin.fx_ops',
  'finance',
  'fx_ops',
  'view',
  'Read the FX orchestration 24h overview — volume, captured margin, provider routing mix, corridor breakdown and float health (GET /api/finance/admin/fx/overview)',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Same grant set as finance.admin.fx_markup: no dedicated finance-ops platform role
-- exists yet (see 20260920000100_rbac_seed_gaps.sql), so super-admin and
-- system-admin are the roles that actually operate the console today.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('super-admin', 'system-admin')
  AND p.slug = 'finance.admin.fx_ops'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
