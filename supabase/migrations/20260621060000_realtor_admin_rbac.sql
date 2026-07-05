-- ── Spotlight Realtor — admin control-plane RBAC + audit log ──────────────────
-- Additive-only. Registers the `realtor.manage` permission that gates the realtor
-- admin control plane (/api/realtor/admin/*) and grants it to super-admin so there
-- is at least one operator out of the box. Also adds the immutable admin audit
-- table that every realtor admin mutation writes to (mirrors invest_admin_audit_log).
-- Template: supabase/migrations/20260621040000_invest_rbac.sql.

-- ── Permission ────────────────────────────────────────────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Manage Realtor','realtor.manage','realtor','module','manage','Manage the Spotlight Realtor admin control plane (moderation, verification, payments, escrow)',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin so the control plane is reachable out of the box. Assign to
-- Property-Ops / Trust-&-Safety / Finance admin roles via the RBAC UI as needed.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug = 'realtor.manage')
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── Admin audit log (immutable; append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS realtor_admin_audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    text NOT NULL,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text,
    old_value   jsonb,
    new_value   jsonb,
    reason      text,
    ip_address  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realtor_admin_audit_entity_idx ON realtor_admin_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS realtor_admin_audit_created_idx ON realtor_admin_audit_log (created_at DESC);
