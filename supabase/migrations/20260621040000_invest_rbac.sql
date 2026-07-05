-- ── Paymax Invest — RBAC permission ──────────────────────────────────────────
-- Additive-only. Registers the `invest.manage` permission that gates the invest
-- admin control plane (/api/v1/admin/invest/*) and grants it to super-admin so
-- there is at least one operator. Assign to Trading-Ops / Product / Finance
-- admin roles via the RBAC UI as needed.

INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Manage Invest','invest.manage','invest','module','manage','Manage the Paymax Invest (stock-trading) admin control plane',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin so the control plane is reachable out of the box.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug = 'invest.manage')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
