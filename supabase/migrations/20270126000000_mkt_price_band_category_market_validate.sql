-- Promote mkt_price_band_category_market_fk to validated, if any environment
-- still has it NOT VALID.
--
-- On every environment we can observe this is already a no-op: 20270121000000
-- adds the constraint VALIDATED when mkt_price_bands holds no cross-market row,
-- and that table is empty everywhere because nothing in the codebase writes it —
-- the only statements touching it are in tests, which clean up after themselves.
-- Locally it reports convalidated = true and refuses a cross-market band by name.
--
-- It exists for the environment we CANNOT observe. If mkt_price_bands ever held a
-- violating row when 20270121000000 ran — seeded by hand, imported, or written by
-- something outside this repository — that environment took the NOT VALID branch
-- and has been enforcing new writes only, silently, ever since. Nothing would
-- report it, because a NOT VALID constraint looks and behaves like a working one
-- until you ask the catalog. This is the sweep that finishes the job there, and
-- costs a NOTICE everywhere else.
--
-- Same conditional as 20270124000000 (the listings twin) for the same reason:
-- VALIDATE scans the table and FAILS on a single surviving violation, so a blind
-- ALTER would turn a data problem into a blocked deploy. Clean environments get
-- promoted; dirty ones keep the constraint, keep refusing new bad writes, and log
-- what is in the way. Re-running after the repair promotes it.
--
-- Additive: adds no object, changes no data. It only upgrades how much of an
-- existing constraint is trusted.

DO $$
DECLARE violations bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_price_bands'::regclass
       AND conname  = 'mkt_price_band_category_market_fk'
  ) THEN
    RAISE NOTICE 'mkt_price_band_category_market_fk is absent — nothing to validate';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_price_bands'::regclass
       AND conname  = 'mkt_price_band_category_market_fk'
       AND convalidated
  ) THEN
    RAISE NOTICE 'mkt_price_band_category_market_fk is already validated';
    RETURN;
  END IF;

  SELECT count(*) INTO violations
    FROM public.mkt_price_bands p
    JOIN public.mkt_categories c ON c.id = p.category_id
   WHERE p.market_id IS DISTINCT FROM c.market_id;

  IF violations = 0 THEN
    ALTER TABLE public.mkt_price_bands VALIDATE CONSTRAINT mkt_price_band_category_market_fk;
  ELSE
    RAISE NOTICE 'mkt_price_bands still has % cross-market row(s); leaving the constraint NOT VALID. '
                 'New writes stay enforced. Repair those rows and re-run to promote it.', violations;
  END IF;
END $$;
