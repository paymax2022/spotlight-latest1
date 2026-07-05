-- ── Paymax Mobility (Transport) — RBAC permissions ───────────────────────────
-- Additive-only. Registers the `mobility.*` permissions that gate the transport
-- admin control plane (/api/finance/admin/transport/*) server-side and grants
-- them all to super-admin so there is at least one operator out of the box.
-- Assign the per-area/per-mode slugs to Dispatch / Ops / Logistics admin roles
-- via the RBAC UI as needed. These slugs must stay in exact sync with the
-- constants in backend/internal/app/finance_routes.go.

INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('View Mobility','mobility.view','mobility','module','view','Read-only access to the mobility (transport) admin console',true),
('Manage Mobility','mobility.manage','mobility','module','manage','Manage general/cross-cutting mobility admin settings (pricing, commission, safety)',true),
('Manage Mobility Ride','mobility.ride.manage','mobility','ride','manage','Manage ride-hailing drivers, vehicles and dispatch',true),
('Manage Mobility Parcel','mobility.parcel.manage','mobility','parcel','manage','Manage parcel delivery operations',true),
('Manage Mobility Bus','mobility.bus.manage','mobility','bus','manage','Manage bus routes, schedules and fares',true),
('Manage Mobility Towing','mobility.towing.manage','mobility','towing','manage','Manage towing operations',true),
('Manage Mobility Movers','mobility.movers.manage','mobility','movers','manage','Manage movers operations',true),
('Manage Mobility Event','mobility.event.manage','mobility','event','manage','Manage event transport offers and bookings',true),
('Manage Mobility Logistics','mobility.logistics.manage','mobility','logistics','manage','Manage business logistics accounts, deliveries and invoices',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant every mobility permission to super-admin so the control plane is
-- reachable out of the box (and admins are never locked out by the new gate).
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE module = 'mobility')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
