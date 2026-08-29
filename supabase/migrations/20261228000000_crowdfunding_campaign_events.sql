-- Migration: record campaign VIEW and SHARE events so creator analytics can be
-- derived from real data instead of fabricated from the campaign id.
--
-- WHY
-- ---
-- The creator performance screen shows Views, Shares, Conversion and a traffic-
-- source breakdown. None of those had a data source: nothing in the schema
-- recorded a view or a share, so
-- backend/internal/crowdfunding/creator/service.go GetCampaignAnalytics invented
-- them from a hash of the campaign id —
--
--     views  := 1200 + idSeed(campaignID)%8000 + contributorCount*40
--     shares := 40 + idSeed(campaignID)%400
--
-- — and split the traffic sources as fixed percentages of that invented number.
-- Those figures looked plausible and moved when contributors changed, which is
-- precisely what made them hard to spot as fake.
--
-- `cf_recently_viewed` already existed but cannot serve this: it is keyed
-- PRIMARY KEY (user_id, campaign_id), so it holds at most one row per user and
-- overwrites viewed_at. It answers "what did I look at recently", not "how many
-- views has this campaign had". It also has no write path anywhere in the
-- codebase, so it is empty.
--
-- WHAT THIS ADDS
-- --------------
-- One append-only event table. VIEW and SHARE live in the SAME table because
-- they share every column and are always queried together for one campaign;
-- two tables would double the indexes and the write paths for no gain.
--
-- `source` is the referrer channel (whatsapp, facebook, direct, …). It is what
-- makes the traffic-source breakdown real, and it is also what allows a
-- contribution to be attributed back to a channel: the analytics query joins a
-- contribution to that contributor's most recent VIEW of the campaign before
-- they gave (last-touch attribution).
--
-- SAFETY
-- ------
--  • Additive only: one new table, no change to any existing table.
--  • Append-only by design — no UPDATE/DELETE path, and RLS grants no write to
--    `authenticated`; only the backend (service_role) inserts.
--  • actor_user_id is NULLABLE on purpose: a campaign page is public, and an
--    anonymous view is still a view. anonymous_id carries the device/session so
--    unique-viewer counts stay meaningful without requiring a login.
--  • ON DELETE CASCADE: if a campaign is removed its events go with it.

CREATE TABLE IF NOT EXISTS public.cf_campaign_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id   UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    event_type    TEXT        NOT NULL CHECK (event_type IN ('VIEW', 'SHARE')),
    -- Referrer channel. Free-text rather than an enum so a new channel does not
    -- need a migration; the analytics query groups on whatever is stored and the
    -- API normalises to a known set before writing.
    source        TEXT        NOT NULL DEFAULT 'direct',
    actor_user_id UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    anonymous_id  TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The analytics read: everything is "for this campaign, of this type, in a
-- window", so campaign_id leads and created_at closes.
CREATE INDEX IF NOT EXISTS cf_campaign_events_campaign_type_time_idx
    ON public.cf_campaign_events (campaign_id, event_type, created_at DESC);

-- Last-touch attribution walks back from a contribution to that user's most
-- recent VIEW of the campaign.
CREATE INDEX IF NOT EXISTS cf_campaign_events_attribution_idx
    ON public.cf_campaign_events (campaign_id, actor_user_id, created_at DESC)
    WHERE event_type = 'VIEW';

ALTER TABLE public.cf_campaign_events ENABLE ROW LEVEL SECURITY;

-- A creator may read the events for their OWN campaigns — that is what powers
-- the performance screen. No INSERT/UPDATE/DELETE policy for `authenticated`:
-- writes go through the backend (service_role bypasses RLS), so a client cannot
-- inflate its own view or share counts by posting rows directly.
DROP POLICY IF EXISTS cf_campaign_events_select_own_campaigns ON public.cf_campaign_events;
CREATE POLICY cf_campaign_events_select_own_campaigns
    ON public.cf_campaign_events
    FOR SELECT
    TO authenticated
    USING (
        campaign_id IN (SELECT id FROM public.campaigns WHERE creator_id = auth.uid())
    );

COMMENT ON TABLE public.cf_campaign_events IS
  'Append-only VIEW/SHARE events per crowdfunding campaign. Powers the real '
  'Views / Shares / Conversion / traffic-source figures on the creator '
  'performance screen, which were previously derived from a hash of the '
  'campaign id. Backend-write only.';
