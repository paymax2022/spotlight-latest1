-- Every paid contest gets a sellable vote package.
--
-- THE DEFECT
-- "September Open Mic Challenge" was open, had an approved contestant on the
-- roster, and could not be voted for by anybody. It set paid_vote_kobo = 10000
-- (NGN 100/vote) and free_votes_per_user = 0, but had no rows in vote_packages.
--
-- That combination is fatal because vote_packages — not connect_contests — is
-- the pricing authority for paid voting. paid-vote.service.ts prices a purchase
-- from a package, and even its "custom quantity" path derives the per-vote rate
-- via getBaseVoteRate(), which reads the first ACTIVE package and throws
-- "No vote packages configured for this contest" when there is none.
-- connect_contests.paid_vote_kobo is never consulted for pricing at all; the
-- mobile app only maps it to a paidVotingEnabled flag, which is what made the
-- buy-votes screen promise a purchase it could not price.
--
-- THE FIX
-- Seed a default ladder from paid_vote_kobo whenever a contest is created or
-- priced, so a contest cannot enter a paid-but-unpriceable state.
--
-- ⚠️ UNITS: vote_packages.amount is NAIRA (major units), while
-- connect_contests.paid_vote_kobo is KOBO. /api/v1/contests/[id]/vote-packages
-- converts with Math.round(amount * 100) and paid-vote.service.ts charges
-- Math.round(amountExpected * 100). Seeding in kobo here would publish every
-- package at 100x its price. Hence the /100.0 below — do not "simplify" it.
--
-- Tiers are straight multiples of the contest's own per-vote price. No invented
-- bulk discount: a discount is a commercial decision for whoever runs the
-- contest, and the admin console can edit these afterwards.

CREATE OR REPLACE FUNCTION public.seed_default_vote_packages(p_contest_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_kobo INTEGER;
  v_rate NUMERIC;      -- naira per vote
  v_rows INTEGER := 0;
BEGIN
  SELECT paid_vote_kobo INTO v_kobo
    FROM public.connect_contests
   WHERE id = p_contest_id;

  IF v_kobo IS NULL OR v_kobo <= 0 THEN
    RETURN 0;  -- free-vote or unpriced contest: nothing to derive a price from.
  END IF;

  -- Any existing package at all, active or not, means somebody has curated this
  -- contest. Re-seeding would resurrect tiers an admin deliberately retired.
  IF EXISTS (SELECT 1 FROM public.vote_packages WHERE contest_id = p_contest_id) THEN
    RETURN 0;
  END IF;

  -- ⚠️ vote_packages.contest_id is a FOREIGN KEY to `contests` — the LEGACY
  -- plane — not to connect_contests, and nothing mirrors one into the other
  -- automatically (9 of 12 connect_contests had a mirror when this was written).
  -- Without this guard the seeder raises a FK violation from inside an AFTER
  -- trigger, which aborts the caller's transaction: creating a contest would
  -- fail outright. A missing mirror must degrade to "no packages yet", never to
  -- "you cannot create a contest".
  IF NOT EXISTS (SELECT 1 FROM public.contests WHERE id = p_contest_id) THEN
    RETURN 0;
  END IF;

  v_rate := v_kobo / 100.0;

  INSERT INTO public.vote_packages
    (id, contest_id, name, description, votes, bonus_votes, amount, currency,
     is_active, is_recommended, display_order, created_at, updated_at)
  VALUES
    (gen_random_uuid(), p_contest_id, 'Starter Pack',
     'Get started supporting your favourite contestant.',
     10,  0, 10  * v_rate, 'NGN', TRUE, FALSE, 1, NOW(), NOW()),
    (gen_random_uuid(), p_contest_id, 'Supporter Pack',
     'A bigger boost for the contestant you believe in.',
     50,  0, 50  * v_rate, 'NGN', TRUE, TRUE,  2, NOW(), NOW()),
    (gen_random_uuid(), p_contest_id, 'Super Fan Pack',
     'Go all in.',
     100, 0, 100 * v_rate, 'NGN', TRUE, FALSE, 3, NOW(), NOW());

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.seed_default_vote_packages(UUID) IS
  'Seeds a default vote package ladder from connect_contests.paid_vote_kobo. '
  'No-op when the contest is unpriced or already has packages. amount is NAIRA.';

-- ---------------------------------------------------------------------------
-- Keep it true going forward
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_seed_default_vote_packages()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.paid_vote_kobo IS NOT NULL AND NEW.paid_vote_kobo > 0 THEN
    PERFORM public.seed_default_vote_packages(NEW.id);
  END IF;
  RETURN NULL;  -- AFTER trigger; return value is ignored.
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_vote_packages ON public.connect_contests;
CREATE TRIGGER trg_seed_default_vote_packages
  AFTER INSERT OR UPDATE OF paid_vote_kobo ON public.connect_contests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_seed_default_vote_packages();

-- A contest row in the legacy plane is what makes the FK satisfiable, and it can
-- appear after the connect_contests row. Seeding on its insert closes the gap the
-- connect_contests trigger alone cannot: at that point the price is known and the
-- parent row exists.
CREATE OR REPLACE FUNCTION public.tg_seed_vote_packages_on_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_vote_packages(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_vote_packages_on_mirror ON public.contests;
CREATE TRIGGER trg_seed_vote_packages_on_mirror
  AFTER INSERT ON public.contests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_seed_vote_packages_on_mirror();

-- ---------------------------------------------------------------------------
-- Backfill contests that are already stuck
-- ---------------------------------------------------------------------------

SELECT public.seed_default_vote_packages(c.id)
  FROM public.connect_contests c
 WHERE c.paid_vote_kobo > 0
   AND NOT EXISTS (SELECT 1 FROM public.vote_packages p WHERE p.contest_id = c.id);

-- NOTE: a contest with paid_vote_kobo = 0 AND free_votes_per_user = 0 is still
-- unvotable, and nothing here can fix it — there is no price to derive and no
-- free allowance to grant, and inventing either would be a commercial decision.
-- The admin console surfaces those as "Not votable" so a human resolves it.
