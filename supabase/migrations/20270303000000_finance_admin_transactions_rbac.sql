-- Paymax super-app — seed RBAC permission for the new centralized admin
-- "Transactions" console (GET /api/finance/admin/transactions).
--
-- WHY THIS MIGRATION
-- The new console is enforced at the route layer via
-- middleware.RequirePermission(rbac, "finance.admin.transactions.view")
-- (backend/internal/app/finance_routes.go). It is a NEW, dedicated slug —
-- deliberately NOT a reuse of "finance.admin.transfers" (the existing wallet
-- service AdminGetBalance/AdminListTransactions handlers reuse that slug for
-- lack of a dedicated one; this console gets its own instead, since it spans
-- ALL ledger activity across every module, not just bank transfers).
--
-- Additive-only. Every write is ON CONFLICT DO NOTHING — no existing row is
-- modified, no DROP/rename/type-narrowing. Re-runnable. Mirrors the exact
-- seed shape of 20260920000100_rbac_seed_gaps.sql.

BEGIN;

-- 1. Seed the new permission -----------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View All Ledger Transactions', 'finance.admin.transactions.view', 'finance', 'admin.transactions', 'view',
   'Centralized read-only admin console listing ALL ledger_entries across every module, joined to the owning account/user (enforced finance_routes.go, GET /api/finance/admin/transactions)', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Grant to super-admin -----------------------------------------------------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'finance.admin.transactions.view')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. Grant to system-admin (platform administration operator) ----------------
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'finance.admin.transactions.view')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
