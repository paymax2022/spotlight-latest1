-- Crowdfunding — full module schema (additive-only).
-- Extends the MVP campaigns/contributions tables (20260616260000_crowdfunding.sql)
-- with discovery metadata, review lifecycle, categories and a decision audit log.
-- IRON RULES: no DROP, no RENAME, no type narrowing. All money is BIGINT kobo.

-- ─── campaign metadata (additive columns) ────────────────────────────────────
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS summary            TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS story              TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS type               TEXT NOT NULL DEFAULT 'DONATION';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS category           TEXT NOT NULL DEFAULT 'community';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS location           TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS refund_policy      TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS disbursement_model TEXT NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS verified           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS featured           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS trending           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS urgent             BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS contributor_count  INTEGER NOT NULL DEFAULT 0;
-- Review lifecycle is SEPARATE from the funding `status` (durable record vs review state).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS review_status      TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (review_status IN ('DRAFT','PENDING_REVIEW','CHANGES_REQUESTED','ACTIVE','COMPLETED','FROZEN','REJECTED'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS admin_note         TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS submitted_at       TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS risk_level         TEXT NOT NULL DEFAULT 'LOW'
    CHECK (risk_level IN ('LOW','MEDIUM','HIGH'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS risk_score         INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS campaigns_review_status_idx ON campaigns(review_status);
CREATE INDEX IF NOT EXISTS campaigns_category_idx      ON campaigns(category);

-- ─── categories ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crowdfunding_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    icon        TEXT NOT NULL,
    tint        TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    enhanced_review BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO crowdfunding_categories (slug, label, icon, tint, enhanced_review, sort_order) VALUES
    ('medical',   'Medical',   'HeartPulse',    'red',    TRUE,  1),
    ('education',  'Education', 'GraduationCap', 'blue',   FALSE, 2),
    ('creative',  'Creative',  'Palette',       'purple', FALSE, 3),
    ('sme',       'SME',       'Store',         'orange', TRUE,  4),
    ('ngo',       'NGO',       'HandHeart',     'teal',   FALSE, 5),
    ('religious', 'Religious', 'Church',        'purple', FALSE, 6),
    ('community', 'Community', 'Users',         'green',  FALSE, 7),
    ('emergency', 'Emergency', 'Siren',         'red',    TRUE,  8),
    ('reward',    'Reward',    'Gift',          'orange', FALSE, 9),
    ('investment','Investment','TrendingUp',    'teal',   TRUE,  10)
ON CONFLICT (slug) DO NOTHING;

-- ─── review decision audit log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    admin_id    UUID NOT NULL REFERENCES auth.users(id),
    decision    TEXT NOT NULL CHECK (decision IN ('APPROVE','REJECT','REQUEST_CHANGES','FREEZE','UNFREEZE')),
    note        TEXT,
    prev_status TEXT NOT NULL,
    new_status  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_reviews_campaign_idx ON campaign_reviews(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_reviews_admin_idx    ON campaign_reviews(admin_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE crowdfunding_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_reviews        ENABLE ROW LEVEL SECURITY;

-- Categories are public read.
DROP POLICY IF EXISTS "cf_categories_select" ON crowdfunding_categories;
CREATE POLICY "cf_categories_select" ON crowdfunding_categories FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_categories_service" ON crowdfunding_categories;
CREATE POLICY "cf_categories_service" ON crowdfunding_categories TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Review log is admin/service only (no authenticated SELECT policy → not visible to members).
DROP POLICY IF EXISTS "campaign_reviews_service" ON campaign_reviews;
CREATE POLICY "campaign_reviews_service" ON campaign_reviews TO service_role USING (TRUE) WITH CHECK (TRUE);
