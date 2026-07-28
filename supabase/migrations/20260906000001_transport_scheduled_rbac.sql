-- ── Paymax Mobility (Transport Trip Scheduling) — RBAC permissions ───────────
-- Additive-only. Registers the `transport.admin.scheduled.*` permissions that
-- gate the scheduled-bookings admin ops board
-- (/api/finance/admin/transport/scheduled/*) server-side, mirroring the exact
-- pattern used for the base mobility RBAC seed in
-- 20260621090000_mobility_rbac.sql, and grants them to the same mobility ops /
-- admin roles created in 20260625130000_mobility_ops_roles.sql.
-- These slugs must stay in exact sync with the constants used by
-- backend/internal/app/finance_routes.go (guard("transport.admin.scheduled.*")).

INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('View Scheduled Transport Bookings','transport.admin.scheduled.read','mobility','scheduled','read','Read-only access to the scheduled trips/parcels/bus ops board',true),
('Reassign Scheduled Transport Bookings','transport.admin.scheduled.reassign','mobility','scheduled','reassign','Manually reassign/force-dispatch a scheduled booking to a driver/courier',true),
('Cancel Scheduled Transport Bookings','transport.admin.scheduled.cancel','mobility','scheduled','cancel','Admin-cancel a scheduled booking and trigger refund if escrowed',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant every transport.admin.scheduled.* permission to super-admin so the
-- control plane is reachable out of the box (and admins are never locked out
-- by the new gate).
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug LIKE 'transport.admin.scheduled.%')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- mobility-ops: full control — read + reassign + cancel.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'mobility-ops'),
     p AS (SELECT id FROM public.permissions WHERE slug LIKE 'transport.admin.scheduled.%')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- dispatch-admin: manages ride/parcel dispatch — read + reassign + cancel
-- (force-dispatch/reassign is core to its job; cancel needed for stuck jobs).
WITH r AS (SELECT id FROM public.roles WHERE slug = 'dispatch-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug LIKE 'transport.admin.scheduled.%')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- logistics-admin: read + reassign (parcel/business logistics scheduling);
-- cancel left to mobility-ops/super-admin to avoid over-granting refund power.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'logistics-admin'),
     p AS (SELECT id FROM public.permissions
           WHERE slug IN ('transport.admin.scheduled.read','transport.admin.scheduled.reassign'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- system-admin: read-only view of the scheduled ops board (no mutations),
-- matching the read-only grant system-admin already has for mobility.view.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'system-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug = 'transport.admin.scheduled.read')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
