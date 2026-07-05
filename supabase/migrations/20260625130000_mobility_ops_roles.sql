-- ── Paymax Mobility — dedicated ops roles ────────────────────────────────────
-- Additive-only. Creates three purpose-built roles for the transport control
-- plane and grants each the minimum mobility.* permissions needed for its
-- function. Grants mobility.view to system-admin so existing platform admins
-- can read the dashboard without a role change.
--
-- Roles created:
--   mobility-ops      — full control of the entire transport module
--   dispatch-admin    — manages ride-hailing and parcel dispatch
--   logistics-admin   — manages business logistics, movers, and event transport

INSERT INTO public.roles(name, slug, description, role_type, is_system_role)
VALUES
('Mobility Ops',      'mobility-ops',      'Full control of the transport/mobility module', 'admin',   true),
('Dispatch Admin',    'dispatch-admin',     'Manages ride-hailing drivers, vehicles, and parcel dispatch', 'admin', true),
('Logistics Admin',   'logistics-admin',    'Manages business logistics, movers, and event transport', 'admin', true)
ON CONFLICT (slug) DO NOTHING;

-- mobility-ops: every mobility permission (view + all manage slugs)
WITH r AS (SELECT id FROM public.roles WHERE slug = 'mobility-ops'),
     p AS (SELECT id FROM public.permissions WHERE module = 'mobility')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- dispatch-admin: view + ride + parcel
WITH r AS (SELECT id FROM public.roles WHERE slug = 'dispatch-admin'),
     p AS (SELECT id FROM public.permissions
           WHERE slug IN ('mobility.view','mobility.ride.manage','mobility.parcel.manage'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- logistics-admin: view + logistics + movers + event
WITH r AS (SELECT id FROM public.roles WHERE slug = 'logistics-admin'),
     p AS (SELECT id FROM public.permissions
           WHERE slug IN ('mobility.view','mobility.logistics.manage','mobility.movers.manage','mobility.event.manage'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- system-admin: read-only view of the transport console (no mutations)
WITH r AS (SELECT id FROM public.roles WHERE slug = 'system-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug = 'mobility.view')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
