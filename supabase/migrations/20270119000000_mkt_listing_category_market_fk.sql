-- A listing's category must belong to the listing's market.
--
-- Nothing enforced this. mkt_listings.market_id and mkt_categories.market_id were
-- independent columns joined only through category_id, so a listing in market NG
-- could sit under a category in another market and no layer objected. In the local
-- database 210 of 229 listings are in exactly that state.
--
-- It matters because market is the tenancy boundary of this module: GET /categories
-- is scoped to one market, and search is now scoped too (see the fallback fix in
-- internal/marketplace). A listing whose category lives in another market is
-- reachable from one half of a market's UI and invisible to the other.
--
-- Enforced as a COMPOSITE FOREIGN KEY rather than a trigger or a CHECK: a CHECK
-- cannot see another table, a trigger can be disabled and has to be maintained,
-- while (category_id, market_id) -> mkt_categories(id, market_id) is enforced by
-- the same machinery as the existing category FK and costs nothing to keep true.
--
-- Additive only, per CLAUDE.md: this adds two constraints and drops, renames and
-- narrows nothing. The UNIQUE it needs is implied by the primary key already, so
-- it cannot fail on any data.
--
-- NOT VALID is deliberate. Existing rows are left unchecked while every INSERT and
-- every UPDATE from here on is enforced. A validating constraint would abort this
-- migration on any environment holding legacy violations — which is precisely the
-- environment that most needs the rule going forward. Once an environment's history
-- is clean, promote it with:
--     ALTER TABLE public.mkt_listings VALIDATE CONSTRAINT mkt_listings_category_market_fk;
-- Note that a NOT VALID constraint still rejects UPDATES to already-violating rows,
-- so those rows must be repaired before they can be edited.

-- The composite key the FK references. (id) is already unique as the primary key,
-- so adding (id, market_id) is guaranteed to succeed and adds no new restriction.
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.mkt_listings'::regclass
       AND conname  = 'mkt_listings_category_market_fk'
  ) THEN
    ALTER TABLE public.mkt_listings
      ADD CONSTRAINT mkt_listings_category_market_fk
      FOREIGN KEY (category_id, market_id)
      REFERENCES public.mkt_categories (id, market_id)
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT mkt_listings_category_market_fk ON public.mkt_listings IS
  'A listing''s category must be in the listing''s market. NOT VALID: enforced on all '
  'new writes; pre-existing rows are unchecked until VALIDATE CONSTRAINT is run.';
