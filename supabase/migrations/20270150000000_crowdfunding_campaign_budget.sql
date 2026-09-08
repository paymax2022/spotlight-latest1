-- Campaign budget: how the creator says the money will be spent.
--
-- The wizard has collected a budget breakdown since it was written, the campaign
-- page has a "Use of funds" block, and there was no table to put any of it in —
-- the submit DTO accepted none of it and GetDetail returned an empty array. So
-- the page rendered "0 budget items" under a heading promising to explain where
-- the money goes.
--
-- Unlike milestones and reward tiers, this one had no table at all; those two
-- already existed and were simply never written to.
--
-- Shape follows the client's BudgetItem: label, amountKobo, note. sort_order
-- preserves the order the creator entered, because a budget reads as a list they
-- composed, not a set.

CREATE TABLE IF NOT EXISTS public.cf_campaign_budget (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 140),
    -- Integer minor units, like every other amount in this codebase. Zero is
    -- allowed: a line item can legitimately be costed at nothing yet.
    amount_kobo bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
    note        text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cf_campaign_budget_campaign_idx
    ON public.cf_campaign_budget (campaign_id, sort_order, created_at);

ALTER TABLE public.cf_campaign_budget ENABLE ROW LEVEL SECURITY;

-- Same shape as the other cf_ tables: the Go backend holds the service role and
-- does its own authorization. A budget is public information on a campaign page,
-- so SELECT is open; writes belong to the campaign's creator, which PostgREST
-- cannot check cheaply here, so they are left to the service role alone.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_budget' AND policyname='cf_campaign_budget_service') THEN
    CREATE POLICY cf_campaign_budget_service ON public.cf_campaign_budget FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cf_campaign_budget' AND policyname='cf_campaign_budget_read') THEN
    CREATE POLICY cf_campaign_budget_read ON public.cf_campaign_budget FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.cf_campaign_budget IS
  'Creator-entered budget lines backing the campaign page''s "Use of funds" block. Amounts are integer minor units.';
