-- Who the campaign is actually for.
--
-- The wizard has a whole step for this — a name and a relationship, and it will
-- not let the creator past it — and the campaign page has a beneficiary slot.
-- The submit DTO accepted neither field and GetDetail returned a literal nil, so
-- "raising for my mother" and "raising for myself" were indistinguishable to
-- everyone who saw the campaign.
--
-- Its own table rather than columns on `campaigns`: `verified` is a trust signal
-- that a human or a KYC check grants, so it wants somewhere to record who granted
-- it and when without widening the campaigns row for every campaign that has no
-- beneficiary at all.

CREATE TABLE IF NOT EXISTS public.cf_campaign_beneficiary (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 140),
    -- Free text rather than an enum: the wizard offers chips (Self, Mother,
    -- Community…) but the set is presentational and will grow, and a CHECK here
    -- would reject a campaign for a relationship the client offered.
    relationship text NOT NULL CHECK (length(btrim(relationship)) BETWEEN 1 AND 60),
    description  text,
    -- NOT settable by the creator. A backer reads this as "somebody checked", so
    -- it is granted by review, never asserted by the person asking for money.
    verified     boolean NOT NULL DEFAULT false,
    verified_at  timestamptz,
    verified_by  uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One beneficiary per campaign. The relationship is 1:1, and the unique index is
-- what makes a re-submission an upsert rather than a second, conflicting answer
-- to "who is this for?".
CREATE UNIQUE INDEX IF NOT EXISTS cf_campaign_beneficiary_campaign_idx
    ON public.cf_campaign_beneficiary (campaign_id);

ALTER TABLE public.cf_campaign_beneficiary ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_beneficiary' AND policyname='cf_campaign_beneficiary_service') THEN
    CREATE POLICY cf_campaign_beneficiary_service ON public.cf_campaign_beneficiary FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  -- Public on a campaign page, like the budget and the reward tiers.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_beneficiary' AND policyname='cf_campaign_beneficiary_read') THEN
    CREATE POLICY cf_campaign_beneficiary_read ON public.cf_campaign_beneficiary FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.cf_campaign_beneficiary IS
  'Who a campaign raises for. One row per campaign. `verified` is granted by review, never set by the creator.';
