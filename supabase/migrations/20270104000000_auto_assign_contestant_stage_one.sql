-- Auto-assign new contestants into stage 1 when their contest has stages.
--
-- The gap: contestant_stage_assignments (20260807000000) is what
-- evict_bottom_percentage() reads to find who's in a stage, but nothing in
-- the repo ever inserted into it. A contestant is created by
-- promote_registration_to_contestant() (20260812020001, called from
-- backend/internal/handlers/registration_admin_store.go on registration
-- approval) — that function has no idea contest_stages exists and never
-- touches contestant_stage_assignments, so "Run eviction" always found zero
-- contestants no matter how many had joined the contest.
--
-- Rule (confirmed with product): a contest with at least one contest_stages
-- row gets its contestants auto-assigned to stage 1, and they progress from
-- there via the eviction mechanic. A contest with ZERO stages stays exactly
-- as it is today — one continuous round, no per-stage elimination — so this
-- trigger is a no-op for every contest that never defines a stage.
--
-- A standalone AFTER INSERT OR UPDATE trigger on contestants, not another
-- edit to promote_registration_to_contestant or the Go handler that calls
-- it: it fires no matter which code path creates or reactivates a
-- contestant row (direct SQL, a future admin tool, this function today),
-- and never needs to be remembered if that function is rewritten again.
-- Additive-only: new function + new trigger, nothing existing altered.

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_contestant_to_stage_one()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contest_id IS NULL OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.contest_stages WHERE contest_id = NEW.contest_id) THEN
    INSERT INTO public.contestant_stage_assignments (contestant_id, contest_id, stage_number, status)
    VALUES (NEW.id, NEW.contest_id, 1, 'active')
    ON CONFLICT (contestant_id, contest_id, stage_number) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_contestant_to_stage_one ON public.contestants;
CREATE TRIGGER trg_assign_contestant_to_stage_one
  AFTER INSERT OR UPDATE OF contest_id, is_active ON public.contestants
  FOR EACH ROW EXECUTE FUNCTION public.assign_contestant_to_stage_one();

-- The other ordering: contestants join first, an admin defines stage 1
-- afterwards (the common real-world order — a contest often runs open
-- registration before its first stage is even configured). Without this,
-- only contestants who join AFTER stage 1 exists would ever get assigned;
-- everyone already on the roster would be silently skipped.
CREATE OR REPLACE FUNCTION public.assign_existing_roster_to_new_stage_one()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage_number = 1 THEN
    INSERT INTO public.contestant_stage_assignments (contestant_id, contest_id, stage_number, status)
    SELECT c.id, c.contest_id, 1, 'active'
    FROM public.contestants c
    WHERE c.contest_id = NEW.contest_id
      AND c.is_active
    ON CONFLICT (contestant_id, contest_id, stage_number) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_existing_roster_to_new_stage_one ON public.contest_stages;
CREATE TRIGGER trg_assign_existing_roster_to_new_stage_one
  AFTER INSERT ON public.contest_stages
  FOR EACH ROW EXECUTE FUNCTION public.assign_existing_roster_to_new_stage_one();

-- Backfill: existing active contestants on contests that already have
-- stages, but joined before either trigger existed.
INSERT INTO public.contestant_stage_assignments (contestant_id, contest_id, stage_number, status)
SELECT c.id, c.contest_id, 1, 'active'
FROM public.contestants c
WHERE c.contest_id IS NOT NULL
  AND c.is_active
  AND EXISTS (SELECT 1 FROM public.contest_stages cs WHERE cs.contest_id = c.contest_id)
ON CONFLICT (contestant_id, contest_id, stage_number) DO NOTHING;

COMMIT;
