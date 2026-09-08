-- An open contest has working voting settings.
--
-- THE DEFECT
-- Buying votes returned 400: "Voting for this contest is still draft. Set its
-- status to active in the voting settings to open it." The contest was open in
-- both contest planes. The draft was a THIRD record — voting_settings — which
-- carries its own status, its own voting_enabled flag, and its own paid/free
-- switches, and which getVotingSettings() checks before any vote is counted.
--
-- HOW BAD
-- getVotingSettings() gates BOTH the free and the paid path, and throws
-- "Voting has not been set up for this contest yet." when no row exists. Only 3
-- of 13 contests had one. So the votability work in 20270127000000 and
-- 20270128000000 was necessary but NOT sufficient: a contest could have free
-- votes and a priced package ladder and still take no votes at all, because
-- nothing had ever created its settings row. This closes that.
--
-- WHAT IT DOES
-- Creates the settings row alongside the contest, and when a contest is OPEN
-- promotes settings that are still `draft` to `active` with voting enabled.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- `paused` and `closed` are deliberate admin decisions and are left untouched —
-- only `draft`, which means "never configured", is promoted. Flags on an already
-- active row are left alone too: an admin who turned paid voting off meant it.
--
-- ⚠️ voting_settings.contest_id is a FOREIGN KEY to the LEGACY `contests` table,
-- like vote_packages.contest_id. Without the mirror from 20270129000000 this
-- would raise a FK violation inside an AFTER trigger and abort contest creation;
-- the same guard is applied here so a missing mirror degrades to "no settings
-- yet" rather than "you cannot create a contest".

CREATE OR REPLACE FUNCTION public.ensure_voting_settings(p_contest_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cc       public.connect_contests%ROWTYPE;
  v_has_paid BOOLEAN;
  v_has_free BOOLEAN;
  v_type     TEXT;
  v_open     BOOLEAN;
  v_touched  BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_cc FROM public.connect_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- FK parent. See the note above.
  IF NOT EXISTS (SELECT 1 FROM public.contests WHERE id = p_contest_id) THEN
    RETURN FALSE;
  END IF;

  v_open := (v_cc.status::text = 'open');
  v_has_free := COALESCE(v_cc.free_votes_per_user, 0) > 0;
  v_has_paid := COALESCE(v_cc.paid_vote_kobo, 0) > 0
                OR EXISTS (SELECT 1 FROM public.vote_packages p
                            WHERE p.contest_id = p_contest_id AND p.is_active);

  v_type := CASE
              WHEN v_has_paid AND v_has_free THEN 'hybrid'
              WHEN v_has_paid                THEN 'paid'
              ELSE 'free'
            END;

  INSERT INTO public.voting_settings
    (contest_id, status, voting_enabled, voting_type,
     free_voting_enabled, paid_voting_enabled, free_votes_per_day)
  VALUES (
    p_contest_id,
    CASE WHEN v_open THEN 'active' ELSE 'draft' END,
    v_open,
    v_type,
    v_has_free,
    v_has_paid,
    GREATEST(COALESCE(v_cc.free_votes_per_user, 0), 1)
  )
  ON CONFLICT (contest_id) DO NOTHING;

  GET DIAGNOSTICS v_touched = ROW_COUNT;
  IF v_touched THEN
    RETURN TRUE;
  END IF;

  -- A row already exists. Only rescue the never-configured case.
  UPDATE public.voting_settings
     SET status              = 'active',
         voting_enabled      = TRUE,
         voting_type         = v_type,
         free_voting_enabled = v_has_free,
         paid_voting_enabled = v_has_paid,
         free_votes_per_day  = GREATEST(COALESCE(v_cc.free_votes_per_user, 0), free_votes_per_day),
         updated_at          = NOW()
   WHERE contest_id = p_contest_id
     AND v_open
     AND status = 'draft';

  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN v_touched;
END;
$$;

COMMENT ON FUNCTION public.ensure_voting_settings(UUID) IS
  'Creates the voting_settings row a contest needs before any vote can be cast, '
  'and promotes never-configured settings to active when the contest is open. '
  'Leaves paused/closed settings and already-active flags alone.';

CREATE OR REPLACE FUNCTION public.tg_ensure_voting_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_voting_settings(NEW.id);
  RETURN NULL;
END;
$$;

-- Named to sort AFTER trg_mirror_connect_contest_to_legacy: AFTER triggers fire
-- in name order, and the mirror creates the `contests` row this one's foreign key
-- needs. It would recover on the next update either way, but there is no reason
-- to make a new contest wait for one.
DROP TRIGGER IF EXISTS trg_z_ensure_voting_settings ON public.connect_contests;
CREATE TRIGGER trg_z_ensure_voting_settings
  AFTER INSERT OR UPDATE OF status, paid_vote_kobo, free_votes_per_user
  ON public.connect_contests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_ensure_voting_settings();

-- ---------------------------------------------------------------------------
-- Backfill every contest
-- ---------------------------------------------------------------------------

SELECT public.ensure_voting_settings(c.id) FROM public.connect_contests c;
