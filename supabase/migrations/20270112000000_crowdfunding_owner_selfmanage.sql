-- Crowdfunding — campaign OWNER self-management (pause/resume, soft-delete,
-- feature requests).
--
-- Additive-only: two nullable timestamp columns and one new table. No DROP, no
-- RENAME, no type narrowing, and in particular NO change to the review_status
-- CHECK constraint.
--
-- WHY paused_at RATHER THAN A NEW review_status VALUE
-- ───────────────────────────────────────────────────
-- campaigns carries two parallel state columns: `status` (the funding cycle:
-- draft/active/funded/failed/cancelled) and `review_status` (the MODERATION
-- lifecycle: DRAFT/PENDING_REVIEW/CHANGES_REQUESTED/ACTIVE/COMPLETED/FROZEN/
-- REJECTED). Public discovery gates on review_status='ACTIVE'
-- (internal/crowdfunding/query.go), so pause has to be visible to that filter.
--
-- Adding 'PAUSED' to review_status was rejected for three reasons:
--   1. It needs DROP CONSTRAINT + ADD CONSTRAINT on the existing CHECK, which is
--      exactly the kind of in-place type change the additive-only rule forbids.
--   2. review_status is the ADMIN's column — FROZEN means "an operator stopped
--      this for fraud". Overloading it with an owner-initiated pause means a
--      creator's resume could clear an admin freeze, and an admin's decision
--      could silently un-pause a campaign the owner deliberately stopped. The
--      two facts are independent and must be stored independently.
--   3. It is lossy: a PAUSED campaign forgets whether it was ACTIVE or
--      COMPLETED, so resume has nothing to restore.
-- A nullable paused_at is orthogonal, remembers WHEN, and never collides with a
-- moderation decision.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS paused_at  TIMESTAMPTZ;

-- WHY deleted_at RATHER THAN A HARD ROW DELETE
-- ────────────────────────────────────────────
-- EVERY foreign key pointing at campaigns(id) is ON DELETE CASCADE:
--   contributions, cf_withdrawals, campaign_reviews, cf_campaign_milestones,
--   cf_reward_tiers, cf_saved_campaigns, cf_recently_viewed, cf_csr_matches.
-- So `DELETE FROM campaigns` does not fail loudly on a campaign with history —
-- it SILENTLY destroys that history. Two consequences make a hard delete unsafe
-- even behind a zero-funds guard:
--   * campaign_reviews is the moderation audit trail. A REJECTED campaign has
--     zero contributions and would therefore pass the funds guard, letting its
--     creator erase the record of the rejection and resubmit clean.
--   * settlement/ledger rows reference the campaign by the TEXT reference
--     'campaign:<id>:contributor:<id>' (internal/crowdfunding/service.go), not
--     by a foreign key, so they are not cascaded — a hard delete orphans them
--     instead, leaving money rows pointing at an id that no longer resolves.
-- Soft-delete keeps the row (and therefore every cascade child) intact while
-- removing the campaign from every read surface.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Discovery's hot path is "live campaigns": ACTIVE, not paused, not deleted.
CREATE INDEX IF NOT EXISTS campaigns_live_idx
    ON campaigns(review_status)
    WHERE paused_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS campaigns_creator_live_idx
    ON campaigns(creator_id)
    WHERE deleted_at IS NULL;

-- ─── owner feature requests ──────────────────────────────────────────────────
-- An owner ASKS to be placed on the featured rail; an admin decides. This table
-- is the queue. It deliberately does NOT touch campaigns.featured — only the
-- admin flags endpoint (/api/crowdfunding/admin/campaigns/:id/flags) may set
-- that, so a creator cannot self-promote onto the app's most prominent surface.
--
-- The reverse direction needs no queue: an owner removing their OWN campaign
-- from the rail is always allowed and clears campaigns.featured directly.
CREATE TABLE IF NOT EXISTS cf_feature_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES auth.users(id),
    status       TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
    note         TEXT NOT NULL DEFAULT '',
    admin_note   TEXT,
    decided_by   UUID,
    decided_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE open request per campaign. A partial unique index (rather than a
-- plain UNIQUE) is what lets the same campaign request again after a rejection
-- or a withdrawal, while making a duplicate open request a hard conflict the
-- database refuses rather than something the application has to remember to
-- check.
CREATE UNIQUE INDEX IF NOT EXISTS cf_feature_requests_one_open_idx
    ON cf_feature_requests(campaign_id) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS cf_feature_requests_queue_idx
    ON cf_feature_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS cf_feature_requests_requester_idx
    ON cf_feature_requests(requested_by);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cf_feature_requests ENABLE ROW LEVEL SECURITY;

-- Owner-scoped reads; the Go backend and the admin queue act via service_role.
DROP POLICY IF EXISTS "cf_feature_requests_select_own" ON cf_feature_requests;
CREATE POLICY "cf_feature_requests_select_own" ON cf_feature_requests
    FOR SELECT TO authenticated USING (requested_by = auth.uid());

DROP POLICY IF EXISTS "cf_feature_requests_service" ON cf_feature_requests;
CREATE POLICY "cf_feature_requests_service" ON cf_feature_requests
    TO service_role USING (TRUE) WITH CHECK (TRUE);
