-- ── Fractional Real Estate — admin control-plane RBAC ─────────────────────────
-- Additive-only. Registers the permission slugs that gate the fractionalre admin
-- control plane (/api/finance/fractionalre/admin/*) and grants the umbrella
-- `fractionalre.manage` to super-admin so there is at least one operator out of
-- the box. Separation-of-duties (maker != checker on distributions/close/refund,
-- and title.verifier != asset creator) is enforced in code on top of these grants.
-- Template: supabase/migrations/20260621060000_realtor_admin_rbac.sql.

-- ── Permissions ───────────────────────────────────────────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Manage Fractional RE','fractionalre.manage','fractionalre','module','manage','Umbrella permission for the Fractional Real Estate admin control plane',true),
('FRE Compliance','fractionalre.compliance','fractionalre','compliance','manage','Compliance queues, KYC decisions, retail-cap overrides',true),
('FRE Asset Manage','fractionalre.asset_manage','fractionalre','asset','manage','Create/edit assets, sponsors and lifecycle transitions',true),
('FRE Title Verify','fractionalre.title_verify','fractionalre','asset','verify','Independent title due-diligence verification (segregated from asset creation)',true),
('FRE Distribution Approve','fractionalre.distribution_approve','fractionalre','distribution','approve','Approve (checker) maker-scheduled distribution runs',true),
('FRE Finance','fractionalre.finance','fractionalre','finance','manage','Escrow, refunds and fee operations',true),
('FRE Sponsor','fractionalre.sponsor','fractionalre','sponsor','manage','Sponsor onboarding and portfolio management',true),
('FRE Support','fractionalre.support','fractionalre','support','manage','Investor support, dashboards and read-only operations',true),
('FRE Audit','fractionalre.audit','fractionalre','audit','read','Read the immutable fractionalre audit log',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant every fractionalre slug to super-admin so the control plane is reachable
-- out of the box. Assign the granular roles (Compliance / Asset-Ops / Title /
-- Distribution-Approver / Finance) to dedicated admin roles via the RBAC UI.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug IN (
        'fractionalre.manage',
        'fractionalre.compliance',
        'fractionalre.asset_manage',
        'fractionalre.title_verify',
        'fractionalre.distribution_approve',
        'fractionalre.finance',
        'fractionalre.sponsor',
        'fractionalre.support',
        'fractionalre.audit'
     ))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
