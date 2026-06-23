-- Crowdfunding module.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── campaigns ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  UUID NOT NULL REFERENCES auth.users(id),
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
    description TEXT,
    goal_kobo   BIGINT NOT NULL CHECK (goal_kobo >= 100),
    status      TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','funded','failed','cancelled')),
    deadline    TIMESTAMPTZ NOT NULL,
    cover_url   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaigns_creator_idx ON campaigns(creator_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx  ON campaigns(status);
CREATE INDEX IF NOT EXISTS campaigns_deadline_idx ON campaigns(deadline);

-- ─── contributions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contributions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contributor_id  UUID NOT NULL REFERENCES auth.users(id),
    amount_kobo     BIGINT NOT NULL CHECK (amount_kobo >= 100),
    status          TEXT NOT NULL DEFAULT 'escrowed'
                        CHECK (status IN ('escrowed','released','refunded')),
    idempotency_key TEXT NOT NULL,
    settlement_id   UUID,   -- references settlements(id) for Settle/Refund calls
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS contributions_campaign_idx     ON contributions(campaign_id);
CREATE INDEX IF NOT EXISTS contributions_contributor_idx  ON contributions(contributor_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE campaigns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;

-- Active/funded/failed campaigns are publicly readable; drafts only to creator.
CREATE POLICY "campaigns_select" ON campaigns FOR SELECT
    TO authenticated
    USING (status IN ('active','funded','failed','cancelled') OR creator_id = auth.uid());

CREATE POLICY "campaigns_insert" ON campaigns FOR INSERT
    TO authenticated
    WITH CHECK (creator_id = auth.uid());

CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE
    TO authenticated
    USING (creator_id = auth.uid());

-- Contributors can see their own; creators can see all contributions to their campaigns.
CREATE POLICY "contributions_select" ON contributions FOR SELECT
    TO authenticated
    USING (
        contributor_id = auth.uid()
        OR EXISTS (SELECT 1 FROM campaigns c WHERE c.id = contributions.campaign_id AND c.creator_id = auth.uid())
    );

-- Service role bypasses all RLS.
CREATE POLICY "campaigns_service"     ON campaigns     TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "contributions_service" ON contributions TO service_role USING (TRUE) WITH CHECK (TRUE);
