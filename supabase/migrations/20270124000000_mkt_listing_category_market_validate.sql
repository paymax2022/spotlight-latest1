-- Promote mkt_listings_category_market_fk from NOT VALID to validated.
--
-- 20270119000000 added it NOT VALID because 210 of 229 listings were in market NG
-- while pointing at categories in market `paymax` — a validating constraint would
-- have aborted that migration on exactly the environments that most needed the
-- rule. New writes have been enforced ever since; the historical rows were simply
-- never checked.
--
-- Those rows have since been repaired (the local database now reports zero
-- cross-market listings), so the constraint can carry its full guarantee: not just
-- "nothing new breaks this" but "nothing in this table breaks this".
--
-- Same conditional shape as 20270121000000, for the same reason: VALIDATE scans
-- the table and FAILS if a single violating row is still present. An environment
-- whose history was repaired gets the promotion; one that still holds a bad row
-- keeps the NOT VALID constraint, keeps enforcing new writes, and logs what is in
-- the way — rather than turning a data problem into a blocked deploy. Re-running
-- this migration after the repair promotes it.
--
-- Additive: this adds no object and changes no data. It only upgrades how much of
-- an existing constraint is trusted.

DO $$
DECLARE violations bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_listings'::regclass
       AND conname  = 'mkt_listings_category_market_fk'
  ) THEN
    RAISE NOTICE 'mkt_listings_category_market_fk is absent — nothing to validate';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_listings'::regclass
       AND conname  = 'mkt_listings_category_market_fk'
       AND convalidated
  ) THEN
    RAISE NOTICE 'mkt_listings_category_market_fk is already validated';
    RETURN;
  END IF;

  SELECT count(*) INTO violations
    FROM public.mkt_listings l
    JOIN public.mkt_categories c ON c.id = l.category_id
   WHERE l.market_id IS DISTINCT FROM c.market_id;

  IF violations = 0 THEN
    ALTER TABLE public.mkt_listings VALIDATE CONSTRAINT mkt_listings_category_market_fk;
  ELSE
    RAISE NOTICE 'mkt_listings still has % cross-market row(s); leaving the constraint NOT VALID. '
                 'New writes stay enforced. Repair those rows and re-run to promote it.', violations;
  END IF;
END $$;
