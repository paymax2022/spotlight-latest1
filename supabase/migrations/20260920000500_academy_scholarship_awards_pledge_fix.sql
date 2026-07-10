-- 20260920000500_academy_scholarship_awards_pledge_fix.sql
-- EdTech School Fees — resolve the scholarship-award ⇄ pledge integration gap.
-- Additive/widening only (no data-losing DROP, no rename, no type-narrow).
--
-- Background: fees/scholarship applies a funded pledge to an invoice by appending an
-- academy_scholarship_awards row that references the PLEDGE (academy_scholarship_pledges,
-- added in 20260918000100) with state='applied'. But the awards table (from
-- 20260815001100) declared:
--     scholarship_id uuid NOT NULL REFERENCES academy_scholarships(id)
--     state text ... CHECK (state IN ('granted','disbursed','revoked'))
-- so the append failed on the live DB two ways: (1) a pledge id is not an
-- academy_scholarships id (FK/NOT-NULL violation), and (2) 'applied' is not in the CHECK.
-- Migration 20260918000100 added pledge_id/invoice_payment_id columns but did NOT relax
-- the FK or widen the CHECK, so the code path could not run. This migration finishes it:
--   * scholarship_id → nullable (pledge-funded awards leave it NULL and use pledge_id)
--   * state CHECK widened to a superset that also admits 'applied'
-- No existing row loses validity (the old three states remain legal; every existing row
-- already had scholarship_id set and a legacy state).
BEGIN;

DO $awards$ BEGIN
  IF to_regclass('public.academy_scholarship_awards') IS NOT NULL THEN
    -- Ensure the pledge linkage columns exist (idempotent with 20260918000100).
    EXECUTE 'ALTER TABLE public.academy_scholarship_awards ADD COLUMN IF NOT EXISTS pledge_id uuid';
    EXECUTE 'ALTER TABLE public.academy_scholarship_awards ADD COLUMN IF NOT EXISTS invoice_payment_id uuid';

    -- Pledge-funded awards reference pledge_id instead of scholarship_id → make it optional.
    EXECUTE 'ALTER TABLE public.academy_scholarship_awards ALTER COLUMN scholarship_id DROP NOT NULL';

    -- Widen the state CHECK to a strict superset (drop the auto-named column CHECK, re-add
    -- the wider one). Guarded by name; safe on replay (db reset recreates from base each run).
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.academy_scholarship_awards'::regclass
        AND conname  = 'academy_scholarship_awards_state_check'
    ) THEN
      EXECUTE 'ALTER TABLE public.academy_scholarship_awards DROP CONSTRAINT academy_scholarship_awards_state_check';
    END IF;
    EXECUTE $c$
      ALTER TABLE public.academy_scholarship_awards
        ADD CONSTRAINT academy_scholarship_awards_state_check
        CHECK (state IN ('granted','disbursed','revoked','applied'))
    $c$;
  END IF;
END $awards$;

CREATE INDEX IF NOT EXISTS idx_academy_scholaward_pledge
  ON public.academy_scholarship_awards(pledge_id);

COMMIT;
