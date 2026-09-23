-- Contest Promotion Phase 1 (2/6) — parent/child contest hierarchy columns.
--
-- Adds the hierarchy + partner + geography columns onto the EXISTING
-- public.contests table (legacy plane; see 20260404210000_create_contests.sql).
-- Arbitrary depth is allowed (local -> regional -> national -> ...); a
-- self-parenting or cyclical parent_contest_id chain is rejected by triggers
-- below, not by a simple CHECK (a CHECK cannot see other rows).
--
-- state/lga: plain free-text columns, matching the repo-wide convention of NOT
-- building a states/LGA reference table (e.g. Arena's home_state) — confirmed
-- no such reference table exists anywhere in the repo.
--
-- Additive only: no DROP, no renames, no type narrowing. Every new column is
-- nullable / has a safe default, so no existing row or writer is affected.

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS parent_contest_id       UUID REFERENCES public.contests(id),
  ADD COLUMN IF NOT EXISTS partner_id              UUID REFERENCES public.contest_partners(id),
  ADD COLUMN IF NOT EXISTS state                   TEXT,
  ADD COLUMN IF NOT EXISTS lga                     TEXT,
  ADD COLUMN IF NOT EXISTS default_promote_top_n   INTEGER;

CREATE INDEX IF NOT EXISTS idx_contests_parent_contest_id
  ON public.contests (parent_contest_id) WHERE parent_contest_id IS NOT NULL;

-- No self-parenting.
ALTER TABLE public.contests
  DROP CONSTRAINT IF EXISTS contests_no_self_parent;
ALTER TABLE public.contests
  ADD CONSTRAINT contests_no_self_parent CHECK (parent_contest_id IS NULL OR parent_contest_id <> id);

ALTER TABLE public.contests
  DROP CONSTRAINT IF EXISTS contests_promote_top_n_nonnegative;
ALTER TABLE public.contests
  ADD CONSTRAINT contests_promote_top_n_nonnegative
  CHECK (default_promote_top_n IS NULL OR default_promote_top_n > 0);

-- ---------------------------------------------------------------------------
-- Cycle prevention — walk the parent chain on INSERT/UPDATE of
-- parent_contest_id and reject if the contest's own id is reachable from its
-- new parent (arbitrary depth; a self-reference is already blocked by the
-- CHECK above, so this only needs to guard depth >= 2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contests_reject_parent_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current UUID;
  v_depth   INT := 0;
BEGIN
  IF NEW.parent_contest_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_current := NEW.parent_contest_id;
  WHILE v_current IS NOT NULL LOOP
    v_depth := v_depth + 1;
    -- Belt and braces against a corrupt/very deep chain — 1000 ancestors is
    -- far beyond any realistic local -> regional -> national depth.
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'contest_parent_chain_too_deep' USING ERRCODE = '22023';
    END IF;
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'contest_parent_cycle_detected' USING ERRCODE = '23514';
    END IF;
    SELECT parent_contest_id INTO v_current FROM public.contests WHERE id = v_current;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contests_reject_parent_cycle ON public.contests;
CREATE TRIGGER trg_contests_reject_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_contest_id ON public.contests
  FOR EACH ROW EXECUTE FUNCTION public.contests_reject_parent_cycle();

COMMENT ON COLUMN public.contests.parent_contest_id IS
  'Optional parent ("mother") contest this contest promotes its top contestants '
  'into. Arbitrary depth; self-reference and cycles rejected by '
  'trg_contests_reject_parent_cycle / the contests_no_self_parent CHECK.';
COMMENT ON COLUMN public.contests.default_promote_top_n IS
  'Default number of top-ranked contestants to promote to the parent contest '
  'when a promotion is requested for this contest, if the request omits an '
  'explicit topN.';
