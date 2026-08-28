-- Crowdfunding admin: Users and KYC/KYB queues were reading disconnected
-- registries (cf_admin_users, cf_kyc_cases) that nothing in the app ever wrote
-- to — the only rows in either table were the fake seed data inserted by
-- 20260622050000_crowdfunding_admin.sql. The admin console derives both live
-- from real data now (campaigns/contributions/auth.users for Users; the
-- platform's existing finance/kyc profiles for KYC), so:
--
--   1. Users needs ONE new table: the single fact that's genuinely
--      admin-authored (a suspend/restrict decision) rather than derived.
--      Everything else about a user (name, email, role, activity, totals) is
--      computed live from campaigns/contributions/auth.users — see
--      backend/internal/crowdfunding/adminext/service.go ListUsers.
--
--   2. KYC/KYB no longer needs cf_kyc_cases/cf_kyc_docs at all — the console
--      now reads the same user_profiles.kyc_* columns finance/kyc already
--      manages (see backend/internal/finance/kyc). Those tables are left in
--      place (additive-only; no DROP) but are no longer read by anything.
--
-- The fake seed rows are removed below by their fixed seed UUIDs only, so this
-- can never touch real data.

CREATE TABLE IF NOT EXISTS cf_user_moderation (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RESTRICTED')),
    note       TEXT NOT NULL DEFAULT '',
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retire the fake cf_admin_users / cf_kyc_cases seed rows now that both
-- consoles read real data. Fixed UUIDs from the original seed migration only.
DELETE FROM cf_user_activity WHERE user_id IN (
    'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
    'a3333333-3333-3333-3333-333333333333', 'a4444444-4444-4444-4444-444444444444',
    'a5555555-5555-5555-5555-555555555555');
DELETE FROM cf_admin_users WHERE id IN (
    'a1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222',
    'a3333333-3333-3333-3333-333333333333', 'a4444444-4444-4444-4444-444444444444',
    'a5555555-5555-5555-5555-555555555555');
DELETE FROM cf_kyc_docs WHERE case_id IN (
    '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333');
DELETE FROM cf_kyc_cases WHERE id IN (
    '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333');
