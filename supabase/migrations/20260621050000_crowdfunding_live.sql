-- Crowdfunding — LIVE platform-configuration admin slice (categories / fees /
-- feature flags). Additive-only.
-- IRON RULES: no DROP of data tables, no RENAME, no type narrowing. All money is
-- BIGINT kobo, all rates are integer basis points.
--
-- Wires the still-mock admin "settings" surfaces in
-- frontend-admin/src/services/crowdfundingAdminService.ts:
--   GET   /api/crowdfunding/admin/config/categories
--   PATCH /api/crowdfunding/admin/config/categories/:id
--   GET   /api/crowdfunding/admin/config/fees
--   PUT   /api/crowdfunding/admin/config/fees
--   GET   /api/crowdfunding/admin/config/flags
--   PATCH /api/crowdfunding/admin/config/flags/:key
--
-- Categories are read from the EXISTING crowdfunding_categories table (created in
-- 20260622000000_crowdfunding_full.sql) — this migration does NOT redefine it.
-- Only the singleton fee config and the feature-flag registry are introduced here.

-- ─── platform fee configuration (singleton) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_fee_config (
    id                     INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    platform_fee_bps       INTEGER NOT NULL DEFAULT 250  CHECK (platform_fee_bps       >= 0),
    payment_fee_bps        INTEGER NOT NULL DEFAULT 150  CHECK (payment_fee_bps        >= 0),
    payment_fee_flat_kobo  BIGINT  NOT NULL DEFAULT 10000 CHECK (payment_fee_flat_kobo >= 0),
    min_contribution_kobo  BIGINT  NOT NULL DEFAULT 10000 CHECK (min_contribution_kobo >= 0),
    max_contribution_kobo  BIGINT  NOT NULL DEFAULT 50000000000 CHECK (max_contribution_kobo >= 0),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single config row (id is pinned to 1 by the CHECK constraint).
INSERT INTO cf_fee_config
    (id, platform_fee_bps, payment_fee_bps, payment_fee_flat_kobo, min_contribution_kobo, max_contribution_kobo)
VALUES
    (1, 250, 150, 10000, 10000, 50000000000)
ON CONFLICT (id) DO NOTHING;

-- ─── feature-flag registry ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_feature_flags (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    locked      BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cf_feature_flags (key, label, description, enabled, locked, sort_order) VALUES
    ('crowdfunding',     'Crowdfunding module',        'Master switch for the whole module.',                 TRUE,  FALSE, 1),
    ('reward_campaigns', 'Reward-based campaigns',     'Allow creators to offer backer rewards.',             TRUE,  FALSE, 2),
    ('milestone_funding','Milestone funding',          'Release funds per verified milestone.',               TRUE,  FALSE, 3),
    ('corporate_csr',    'Corporate CSR / matching',   'Sponsor matching donations.',                         FALSE, FALSE, 4),
    ('investment',       'Investment crowdfunding',    'Equity/debt. Requires regulatory licence.',           FALSE, TRUE,  5)
ON CONFLICT (key) DO NOTHING;

-- ─── RLS — service_role bypass ONLY (admin-operational config, not member-readable) ──
ALTER TABLE cf_fee_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_feature_flags  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cf_fee_config_service"    ON cf_fee_config;
CREATE POLICY "cf_fee_config_service"    ON cf_fee_config    TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "cf_feature_flags_service" ON cf_feature_flags;
CREATE POLICY "cf_feature_flags_service" ON cf_feature_flags TO service_role USING (TRUE) WITH CHECK (TRUE);
