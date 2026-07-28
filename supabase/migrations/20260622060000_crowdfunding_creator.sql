-- Crowdfunding — creator dashboard, milestones, reward fulfilment, saves (additive-only).
-- Extends the crowdfunding module with the creator-facing slice: campaign milestones,
-- reward tiers + backers (fulfilment), saved / recently-viewed campaigns and creator
-- notifications.
-- IRON RULES: no DROP, no RENAME, no type narrowing. All money is BIGINT kobo.
-- Balances are NEVER stored: raised/contributor counts are derived from `contributions`.
-- RLS is owner-scoped; the service_role bypasses RLS for server-side writes.

-- ─── campaign milestones ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_campaign_milestones (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    target_kobo    BIGINT NOT NULL DEFAULT 0 CHECK (target_kobo >= 0),
    status         TEXT NOT NULL DEFAULT 'LOCKED'
                       CHECK (status IN ('LOCKED','ACTIVE','RELEASED','PENDING_REVIEW')),
    due_at         TIMESTAMPTZ,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_campaign_milestones_campaign_idx ON cf_campaign_milestones(campaign_id);

-- ─── reward tiers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_reward_tiers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id        UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    amount_kobo        BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    description        TEXT,
    estimated_delivery TEXT,
    claimed            INTEGER NOT NULL DEFAULT 0,
    tier_limit         INTEGER,
    requires_shipping  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_reward_tiers_campaign_idx ON cf_reward_tiers(campaign_id);

-- ─── reward backers (fulfilment) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_reward_backers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_id           UUID REFERENCES cf_reward_tiers(id) ON DELETE SET NULL,
    backer_name       TEXT NOT NULL,
    reward_tier_title TEXT NOT NULL,
    amount_kobo       BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    status            TEXT NOT NULL DEFAULT 'PENDING_PRODUCTION'
                          CHECK (status IN ('PENDING_PRODUCTION','READY','SHIPPED','DELIVERED','DELAYED','CANCELLED')),
    shipping_city     TEXT,
    requires_shipping BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_reward_backers_tier_idx   ON cf_reward_backers(tier_id);
CREATE INDEX IF NOT EXISTS cf_reward_backers_status_idx ON cf_reward_backers(status);

-- ─── saved campaigns ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_saved_campaigns (
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS cf_saved_campaigns_user_idx ON cf_saved_campaigns(user_id);

-- ─── recently viewed ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_recently_viewed (
    user_id     UUID NOT NULL REFERENCES auth.users(id),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS cf_recently_viewed_user_idx ON cf_recently_viewed(user_id);

-- ─── refund requests (record-only — no money moves) ──────────────────────────
-- A contributor's intent to be refunded. The contributions table's status CHECK
-- does not include 'REFUND_REQUESTED', so the intent is recorded here instead.
-- IRON RULE: this NEVER moves money — an admin processes the refund separately.
CREATE TABLE IF NOT EXISTS cf_refund_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contribution_id UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    requester_id    UUID NOT NULL REFERENCES auth.users(id),
    reason          TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'REFUND_REQUESTED'
                        CHECK (status IN ('REFUND_REQUESTED','APPROVED','REJECTED','REFUNDED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contribution_id)
);

CREATE INDEX IF NOT EXISTS cf_refund_requests_requester_idx ON cf_refund_requests(requester_id);

-- ─── creator notifications ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_creator_notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES auth.users(id),
    type       TEXT NOT NULL DEFAULT 'CONTRIBUTION',
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    read       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_creator_notifications_creator_idx ON cf_creator_notifications(creator_id);

-- ─── optional seed (skipped automatically when no campaign exists) ────────────
-- Seed a couple of milestones for the first campaign, if any campaign exists.
INSERT INTO cf_campaign_milestones (campaign_id, title, target_kobo, status, sort_order)
SELECT c.id, 'Initial fundraising goal', 5000000, 'ACTIVE', 0
FROM campaigns c
ORDER BY c.created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO cf_campaign_milestones (campaign_id, title, target_kobo, status, sort_order)
SELECT c.id, 'Phase two delivery', 10000000, 'LOCKED', 1
FROM campaigns c
ORDER BY c.created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO cf_reward_backers (backer_name, reward_tier_title, amount_kobo, status, shipping_city, requires_shipping)
VALUES
    ('Chidi Okafor', 'Early Supporter Pack', 500000, 'PENDING_PRODUCTION', 'Lagos', TRUE),
    ('Ngozi Adeyemi', 'Digital Thank-You', 100000, 'READY', NULL, FALSE)
ON CONFLICT DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cf_campaign_milestones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_reward_tiers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_reward_backers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_saved_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_recently_viewed       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_creator_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_refund_requests       ENABLE ROW LEVEL SECURITY;

-- Refund requests are owner-scoped (the requester); admin acts via service_role.
DROP POLICY IF EXISTS "cf_refund_requests_select_own" ON cf_refund_requests;
CREATE POLICY "cf_refund_requests_select_own" ON cf_refund_requests
    FOR SELECT TO authenticated USING (requester_id = auth.uid());
DROP POLICY IF EXISTS "cf_refund_requests_service" ON cf_refund_requests;
CREATE POLICY "cf_refund_requests_service" ON cf_refund_requests
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Milestones & reward tiers are publicly readable (campaign detail); writes via service.
DROP POLICY IF EXISTS "cf_campaign_milestones_select" ON cf_campaign_milestones;
CREATE POLICY "cf_campaign_milestones_select" ON cf_campaign_milestones
    FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_campaign_milestones_service" ON cf_campaign_milestones;
CREATE POLICY "cf_campaign_milestones_service" ON cf_campaign_milestones
    TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "cf_reward_tiers_select" ON cf_reward_tiers;
CREATE POLICY "cf_reward_tiers_select" ON cf_reward_tiers
    FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_reward_tiers_service" ON cf_reward_tiers;
CREATE POLICY "cf_reward_tiers_service" ON cf_reward_tiers
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Reward backers (fulfilment) are managed by the creator/service only.
DROP POLICY IF EXISTS "cf_reward_backers_service" ON cf_reward_backers;
CREATE POLICY "cf_reward_backers_service" ON cf_reward_backers
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Saved campaigns are owner-scoped.
DROP POLICY IF EXISTS "cf_saved_campaigns_select_own" ON cf_saved_campaigns;
CREATE POLICY "cf_saved_campaigns_select_own" ON cf_saved_campaigns
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_saved_campaigns_modify_own" ON cf_saved_campaigns;
CREATE POLICY "cf_saved_campaigns_modify_own" ON cf_saved_campaigns
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_saved_campaigns_service" ON cf_saved_campaigns;
CREATE POLICY "cf_saved_campaigns_service" ON cf_saved_campaigns
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Recently viewed are owner-scoped.
DROP POLICY IF EXISTS "cf_recently_viewed_select_own" ON cf_recently_viewed;
CREATE POLICY "cf_recently_viewed_select_own" ON cf_recently_viewed
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_recently_viewed_modify_own" ON cf_recently_viewed;
CREATE POLICY "cf_recently_viewed_modify_own" ON cf_recently_viewed
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_recently_viewed_service" ON cf_recently_viewed;
CREATE POLICY "cf_recently_viewed_service" ON cf_recently_viewed
    TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Creator notifications are owner-scoped.
DROP POLICY IF EXISTS "cf_creator_notifications_select_own" ON cf_creator_notifications;
CREATE POLICY "cf_creator_notifications_select_own" ON cf_creator_notifications
    FOR SELECT TO authenticated USING (creator_id = auth.uid());
DROP POLICY IF EXISTS "cf_creator_notifications_service" ON cf_creator_notifications;
CREATE POLICY "cf_creator_notifications_service" ON cf_creator_notifications
    TO service_role USING (TRUE) WITH CHECK (TRUE);
