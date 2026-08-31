-- No OPEN contest is a dead end.
--
-- Migration 20270127000000 guaranteed that a contest with a per-vote price gets
-- sellable packages. It could not help the other shape of dead contest: no
-- per-vote price AND no free votes. Four contests were in that state, one of
-- them already `open`.
--
-- Nothing can derive a PRICE for those — there is no number to derive it from,
-- and inventing one sets commercial terms. A free allowance is different: it
-- charges nobody, it is reversible with one field, and this codebase already has
-- an unambiguous house default. Every one of the seven votable contests grants
-- exactly 1 free vote per user. So this follows the existing convention rather
-- than introducing a new one.
--
-- Two of the four cannot hold vote packages at all: vote_packages.contest_id is
-- a FK to the legacy `contests` table and those rows have no mirror there. A
-- free allowance is the ONLY mechanism that can make them votable, which is a
-- second reason this is the right lever.
--
-- GOING FORWARD the default applies only when a contest is OPEN. A draft is
-- allowed to be half-configured — that is what draft means, and silently
-- rewriting an admin's explicit 0 while they are still setting up would be the
-- kind of "helpful" surprise that erodes trust in the console. The guarantee
-- that matters is that nothing PUBLISHED is unvotable.

-- ---------------------------------------------------------------------------
-- 1. Going forward: opening a contest makes it votable
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_open_contest_needs_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open'
     AND COALESCE(NEW.paid_vote_kobo, 0) <= 0
     AND COALESCE(NEW.free_votes_per_user, 0) <= 0
  THEN
    -- 1 free vote per user: the value every other votable contest uses.
    NEW.free_votes_per_user := 1;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_open_contest_needs_votes() IS
  'An open contest with no per-vote price and no free allowance cannot be voted '
  'in by anyone. Grants the house default of 1 free vote/user rather than '
  'letting it go live dead. Drafts are left alone.';

DROP TRIGGER IF EXISTS trg_open_contest_needs_votes ON public.connect_contests;
CREATE TRIGGER trg_open_contest_needs_votes
  BEFORE INSERT OR UPDATE OF status, paid_vote_kobo, free_votes_per_user
  ON public.connect_contests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_open_contest_needs_votes();

-- ---------------------------------------------------------------------------
-- 2. Fix the ones already stuck — drafts included, on request
-- ---------------------------------------------------------------------------

UPDATE public.connect_contests
   SET free_votes_per_user = 1,
       updated_at = NOW()
 WHERE COALESCE(paid_vote_kobo, 0) <= 0
   AND COALESCE(free_votes_per_user, 0) <= 0;

-- After this, every contest is votable by one route or the other: a free
-- allowance, or a package ladder priced from paid_vote_kobo (20270127000000).
-- Turning a contest into a PAID one later still works: set paid_vote_kobo and
-- the ladder trigger seeds it. Clearing the free allowance on an open contest
-- with no price puts it back to 1, by design.
