-- campaigns.contributor_count is maintained, instead of being permanently 0.
--
-- The column is READ in at least six places — the public campaign payload
-- (service_discovery.go), the "trending" and "verified/featured" sort orders
-- (query.go: ORDER BY c.contributor_count DESC), the featured console, the
-- feature-request queue and the CSR listing — and is WRITTEN by nothing. No Go
-- code, no RPC, no trigger ever set it. So it holds its default for the life of
-- a campaign, and today's data shows the result: a campaign with two backers and
-- ₦1,050 raised reports 0 backers to every one of those surfaces.
--
-- Two consequences, the second easy to miss:
--   1. The public campaign page tells visitors a funded campaign has no backers.
--   2. Sorting is silently meaningless. "Trending" and the featured ordering both
--      sort by this column, so with every value equal to 0 the sort collapses to
--      whatever the tiebreaker is. That looks like a working feature.
--
-- A trigger rather than application code: the column had no owner, and giving it
-- one in a single Go path would leave every other writer (admin tooling, RPCs,
-- backfills, tests, manual SQL) drifting it again. This makes the invariant hold
-- regardless of who writes the row.

-- Recount rather than increment. An incremental +1/-1 has to be right about
-- every transition — including the UPDATE that flips escrowed→refunded, a
-- contributor's SECOND contribution (which must not add a backer), and a
-- campaign_id move — and any missed case drifts silently and permanently, which
-- is exactly the failure being repaired. A recount cannot drift: it is derived.
CREATE OR REPLACE FUNCTION public.cf_sync_campaign_contributor_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected uuid[];
  cid uuid;
BEGIN
  -- An UPDATE can move a contribution between campaigns, so both sides are
  -- recounted. NULLs are dropped: TG_OP INSERT has no OLD, DELETE has no NEW.
  affected := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.campaign_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.campaign_id END
    ]) AS x WHERE x IS NOT NULL
  );

  FOREACH cid IN ARRAY affected LOOP
    UPDATE public.campaigns c
       SET contributor_count = (
             -- DISTINCT contributors, not contributions: one person funding
             -- twice is one backer. 'refunded' is excluded — that money went
             -- back, and counting it would overstate support on exactly the
             -- campaigns where it matters most.
             SELECT COUNT(DISTINCT k.contributor_id)
               FROM public.contributions k
              WHERE k.campaign_id = cid
                AND k.status IN ('escrowed', 'released')
           )
     WHERE c.id = cid;
  END LOOP;

  RETURN NULL; -- AFTER trigger; the return value is ignored
END;
$$;

COMMENT ON FUNCTION public.cf_sync_campaign_contributor_count() IS
  'Keeps campaigns.contributor_count equal to the number of DISTINCT contributors '
  'with a non-refunded contribution. Recounts rather than increments so it cannot drift.';

DROP TRIGGER IF EXISTS cf_contributions_sync_contributor_count ON public.contributions;
CREATE TRIGGER cf_contributions_sync_contributor_count
AFTER INSERT OR UPDATE OF campaign_id, contributor_id, status OR DELETE
ON public.contributions
FOR EACH ROW
EXECUTE FUNCTION public.cf_sync_campaign_contributor_count();

-- The recount runs per affected row, so it needs to be cheap. The existing
-- contributions_campaign_idx covers the lookup; this one lets the DISTINCT be
-- answered from the index alone.
CREATE INDEX IF NOT EXISTS contributions_campaign_contributor_status_idx
  ON public.contributions (campaign_id, contributor_id, status);

-- Backfill every campaign, not only the ones currently wrong: the column has
-- never been maintained, so "currently correct" is coincidence (both sides zero)
-- rather than a state worth preserving.
UPDATE public.campaigns c
   SET contributor_count = COALESCE((
         SELECT COUNT(DISTINCT k.contributor_id)
           FROM public.contributions k
          WHERE k.campaign_id = c.id
            AND k.status IN ('escrowed', 'released')
       ), 0)
 WHERE COALESCE(c.contributor_count, 0) <> COALESCE((
         SELECT COUNT(DISTINCT k.contributor_id)
           FROM public.contributions k
          WHERE k.campaign_id = c.id
            AND k.status IN ('escrowed', 'released')
       ), 0);
