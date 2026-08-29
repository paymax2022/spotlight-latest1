-- Backfill founder memberships for associations created before the founder
-- membership was written at publish time.
--
-- PublishOrganisation inserted assoc_organisations.created_by but never an
-- assoc_memberships / assoc_member_roles pair, so every founder was locked out
-- of the organisation they created: GetAdminAccess, requireAssocAdmin and
-- resolveOrgID all join through those two tables and fail closed.
--
-- Additive and idempotent: inserts only where no membership/role already
-- exists, so a re-run (or a replay of the chain) is a no-op. No column is
-- dropped, renamed or narrowed.

-- 1. Founder membership: ACTIVE + PAID, matching what the publish path now writes.
INSERT INTO assoc_memberships
  (organisation_id, user_id, member_code, category_id, status, payment_standing, verified, joined_at)
SELECT
  o.id,
  o.created_by,
  'FDR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (SELECT c.id FROM assoc_membership_categories c
    WHERE c.organisation_id = o.id ORDER BY c.label LIMIT 1),
  'ACTIVE',
  'PAID',
  true,
  o.created_at
FROM assoc_organisations o
WHERE o.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM assoc_memberships m
     WHERE m.organisation_id = o.id AND m.user_id = o.created_by)
ON CONFLICT (organisation_id, user_id) DO NOTHING;

-- 2. Companion profile row. Every association read path joins
--    assoc_member_profiles; a membership without one makes /me/profile,
--    /me/privacy, the directory and all settings endpoints fail or no-op.
INSERT INTO assoc_member_profiles (membership_id, full_name, email)
SELECT
  m.id,
  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
  u.email
FROM assoc_memberships m
JOIN assoc_organisations o
  ON o.id = m.organisation_id AND o.created_by = m.user_id
LEFT JOIN platform_users u ON u.id = m.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM assoc_member_profiles p WHERE p.membership_id = m.id);

-- 3. SUPER_ADMIN / NATIONAL role so the founder can actually administer the org.
INSERT INTO assoc_member_roles (membership_id, role, jurisdiction, granted_by)
SELECT m.id, 'SUPER_ADMIN', 'NATIONAL', m.user_id
FROM assoc_memberships m
JOIN assoc_organisations o
  ON o.id = m.organisation_id AND o.created_by = m.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM assoc_member_roles r
   WHERE r.membership_id = m.id AND r.role = 'SUPER_ADMIN');
