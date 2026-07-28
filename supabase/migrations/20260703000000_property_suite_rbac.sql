-- ── Property Management suite — unification RBAC ──────────────────────────────
-- Additive-only. Registers the permission slugs that gate the Property Management
-- umbrella (which unifies the existing estate visitor-access module + the realtor
-- agency/portfolio plane) and grants them to super-admin so there is at least one
-- operator out of the box. Assign to Property-Ops / Estate-Admin / Agency roles via
-- the RBAC UI as needed.
-- Template: supabase/migrations/20260621060000_realtor_admin_rbac.sql.

-- ── Permissions ───────────────────────────────────────────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Manage Property Suite','property.manage','property','module','manage','Administer the Property Management suite (cross-module: rent-passport screening, context, estate+agency umbrella)',true),
('Estate Admin','estate.admin','estate','module','admin','Full estate administration (config, residents, elections, finance)',true),
('Manage Estate Operations','estate.manage','estate','module','manage','Estate operations: dues, vendors, gates, guard ops',true),
('Manage Agency Portfolio','agency.manage','agency','module','manage','Agency / portfolio administration (realtor portfolios, listings, screening)',true)
ON CONFLICT (slug) DO NOTHING;

-- ── Grant to super-admin (out-of-the-box operator) ────────────────────────────
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug IN
            ('property.manage','estate.admin','estate.manage','agency.manage'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
