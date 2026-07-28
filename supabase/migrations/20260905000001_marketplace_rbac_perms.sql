-- Paymax Marketplace — RBAC permission seed (Agent C, Marketplace Swarm)
-- Ref: docs/prd/marketplace/SWARM_INTEGRATION_CONTRACT.md,
--      docs/prd/marketplace/Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §3
--      (admin routes), backend/internal/app/placement_routes.go (guard(...)
--      pattern), 20260627000000_connect_rbac.sql (seed shape mirrored below).
--
-- Additive-only. Seeds marketplace.admin.* permissions into the existing
-- enterprise RBAC tables (public.permissions / public.roles /
-- public.role_permissions from 20260527100000_enterprise_auth_rbac.sql).
-- Every write is ON CONFLICT DO NOTHING — no existing rows are modified.
--
-- Naming convention (matches connect.*/placement.*): slug = module.resource.action,
-- module = 'marketplace'. Agent A's Gin admin routes call
-- guard("marketplace.admin.<perm>") per route (see backend/internal/app/
-- placement_routes.go for the exact guard(...) middleware wiring pattern) —
-- Agent A and Agent E MUST use the slugs below verbatim.
--
-- A dedicated 'marketplace-fraud-ops' role is introduced (no fraud/moderation
-- role exists yet in the base RBAC seed) for the Trust & Fraud Desk staff who
-- work the dispute/flags/audit queues but should NOT get full admin.

BEGIN;

-- 1. Dedicated Marketplace Fraud Ops role --------------------------------------
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
  ('Marketplace Fraud Ops', 'marketplace-fraud-ops',
   'Trust & Fraud Desk staff: reviews Marketplace moderation queue, disputes, and flags',
   'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Marketplace admin permissions ---------------------------------------------
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Marketplace Moderation Queue', 'marketplace.admin.moderation',     'marketplace', 'moderation', 'view',    'View the Marketplace listing moderation queue (GET /admin/moderation/queue)', true),
  ('Approve Marketplace Listing',       'marketplace.admin.approve',        'marketplace', 'listing',    'approve', 'Approve a pending-review Marketplace listing',                                 true),
  ('Reject Marketplace Listing',        'marketplace.admin.reject',         'marketplace', 'listing',    'reject',  'Reject a pending-review Marketplace listing (reason_code mandatory)',         true),
  ('Review Marketplace Dispute',        'marketplace.admin.dispute.review', 'marketplace', 'dispute',    'review',  'View the Marketplace dispute queue and evidence (GET /admin/disputes/*)',     true),
  ('Decide Marketplace Dispute',        'marketplace.admin.dispute.decide', 'marketplace', 'dispute',    'decide',  'Decide a Marketplace dispute (refund/release/split; reason_code mandatory)',  true),
  ('Approve Marketplace Dispute',       'marketplace.admin.dispute.approve','marketplace', 'dispute',    'approve', 'Second-approver sign-off on disputes > NGN 500k (dual-approval)',              true),
  ('Action Marketplace Flags',          'marketplace.admin.flags.action',   'marketplace', 'flags',      'action',  'Action or dismiss a Marketplace safety/content flag',                          true),
  ('Read Marketplace Audit Log',        'marketplace.admin.audit.read',     'marketplace', 'audit',      'read',    'Read the Marketplace admin audit log (GET /admin/audit-log)',                  true),
  ('View Marketplace Orders Aging',     'marketplace.admin.orders.aging',   'marketplace', 'orders',     'aging',   'View the Marketplace stuck/aging orders dashboard (GET /admin/orders/aging)', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Grant full marketplace.admin.* to super-admin (kept complete/visible) ----
WITH p AS (SELECT id FROM public.permissions WHERE module = 'marketplace')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Grant full marketplace.admin.* to system-admin (platform administration) -
WITH p AS (SELECT id FROM public.permissions WHERE module = 'marketplace')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 5. Grant moderation-facing subset to a generic 'moderator' role, if present.
--    (No base 'moderator' role slug exists in the enterprise seed today; this
--    is a no-op guarded INSERT so it activates automatically if/when Agent A
--    or another module introduces a role with slug = 'moderator' later —
--    additive and forward-compatible, never errors if absent.)
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'marketplace.admin.moderation',
    'marketplace.admin.approve',
    'marketplace.admin.reject',
    'marketplace.admin.flags.action'
  )
), r AS (
  SELECT id FROM public.roles WHERE slug = 'moderator'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6. Grant operational subset to marketplace-fraud-ops -------------------------
--    (moderation queue, dispute review/decide, flags, audit read, orders aging —
--    everything the Trust & Fraud Desk needs day-to-day; dispute.approve
--    (second-approver dual-approval sign-off) is also granted here so a second
--    fraud-ops staffer, distinct from the decider, can complete the dual
--    approval flow per §2.3/§6.3 of the build contract).
WITH p AS (
  SELECT id FROM public.permissions
  WHERE slug IN (
    'marketplace.admin.moderation',
    'marketplace.admin.approve',
    'marketplace.admin.reject',
    'marketplace.admin.dispute.review',
    'marketplace.admin.dispute.decide',
    'marketplace.admin.dispute.approve',
    'marketplace.admin.flags.action',
    'marketplace.admin.audit.read',
    'marketplace.admin.orders.aging'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'marketplace-fraud-ops'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
