-- A price band's category must belong to the price band's market.
--
-- Same defect as 20270119000000 fixed for mkt_listings, in the one other table
-- carrying the pair: mkt_price_bands has both market_id and category_id, joined
-- only through a category_id FK that says nothing about the market. A band
-- computed for market NG could hang off a category in another market.
--
-- The difference is timing, and it is the whole reason this is cheap: the table
-- is EMPTY and has no writer anywhere in the repository — mkt_price_bands appears
-- only in its CREATE TABLE (20260905000000) and the RLS lockdown
-- (20261201000000). No Go, no TypeScript. So the rule is being established before
-- the first row exists, rather than after 210 of them, which is what happened to
-- mkt_listings.
--
-- Additive: adds one constraint, drops and narrows nothing. The UNIQUE it
-- references is created by 20270119000000; it is re-asserted defensively below so
-- this file does not depend on the ordering of a sibling migration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_categories'::regclass
       AND conname  = 'mkt_categories_id_market_key'
  ) THEN
    ALTER TABLE public.mkt_categories
      ADD CONSTRAINT mkt_categories_id_market_key UNIQUE (id, market_id);
  END IF;
END $$;

-- Validated when the table can take it, NOT VALID when it cannot.
--
-- A plain (validated) constraint is the stronger outcome and succeeds trivially on
-- an empty table, but it would ABORT this migration on any environment holding a
-- violating row — turning a data problem into a blocked deploy. Choosing per
-- environment gives full enforcement wherever it is achievable and never blocks:
-- an environment with dirty history still gets the rule on all new writes, and
-- promotes it with
--     ALTER TABLE public.mkt_price_bands VALIDATE CONSTRAINT mkt_price_band_category_market_fk;
-- once repaired.
DO $$
DECLARE violations bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_price_bands'::regclass
       AND conname  = 'mkt_price_band_category_market_fk'
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO violations
    FROM public.mkt_price_bands p
    JOIN public.mkt_categories c ON c.id = p.category_id
   WHERE p.market_id IS DISTINCT FROM c.market_id;

  IF violations = 0 THEN
    ALTER TABLE public.mkt_price_bands
      ADD CONSTRAINT mkt_price_band_category_market_fk
      FOREIGN KEY (category_id, market_id)
      REFERENCES public.mkt_categories (id, market_id);
  ELSE
    RAISE NOTICE 'mkt_price_bands has % cross-market row(s); adding the constraint NOT VALID', violations;
    ALTER TABLE public.mkt_price_bands
      ADD CONSTRAINT mkt_price_band_category_market_fk
      FOREIGN KEY (category_id, market_id)
      REFERENCES public.mkt_categories (id, market_id)
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT mkt_price_band_category_market_fk ON public.mkt_price_bands IS
  'A price band''s category must be in the band''s market. Mirrors '
  'mkt_listings_category_market_fk (20270119000000).';
