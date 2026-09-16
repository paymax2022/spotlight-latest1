-- Crowdfunding admin review: real authorization.
--
-- The /api/crowdfunding/admin routes were authenticated but NOT authorized — any
-- signed-in user could call POST /campaigns/:id/decision and approve, reject or
-- freeze a campaign. Authentication answers "who are you"; nothing was asking
-- "may you".
--
-- Two permissions, not one, mirroring the escrow pair (escrow.admin.view /
-- escrow.admin.resolve): reading the moderation queue and DECIDING on a campaign
-- are different levels of trust, and an ops reviewer who may triage should not
-- automatically be able to release a campaign to the public.
--
-- Granted to super-admin and system-admin, which is where the comparable
-- finance.admin.* permissions already sit — so the existing operator keeps access
-- and the gate does not lock the console the moment it is switched on.
--
-- Additive only: inserts are idempotent on slug, and no existing row is modified.
--
-- Note that user_has_permission() short-circuits TRUE for super-admin before it
-- consults effective_permissions, so the super-admin grant below is redundant for
-- access. It is written anyway so the role's rights are visible in
-- role_permissions rather than only implied by a bypass inside a function — the
-- system-admin grant is the one that actually decides anything.

INSERT INTO permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Campaign Review Queue', 'crowdfunding.admin.review', 'crowdfunding', 'campaign', 'view',
   'View submitted campaigns awaiting moderation, including risk level', TRUE),
  ('Decide Campaign Review',     'crowdfunding.admin.decide', 'crowdfunding', 'campaign', 'manage',
   'Approve, reject, request changes on, or freeze a submitted campaign', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Grant both to the roles that already hold the equivalent finance admin rights.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug IN ('super-admin', 'system-admin')
  AND p.slug IN ('crowdfunding.admin.review', 'crowdfunding.admin.decide')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
