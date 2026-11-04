-- Group-pool detail fields the create form already collects. Additive-only:
-- every column is NOT NULL with a default, so existing rows and pre-migration
-- clients keep working. goal_kobo is 0 when the organiser set no target.
BEGIN;

ALTER TABLE public.group_pools
  ADD COLUMN IF NOT EXISTS description text   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS goal_kobo   bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_rule text   NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_pools_goal_kobo_nonnegative'
  ) THEN
    ALTER TABLE public.group_pools
      ADD CONSTRAINT group_pools_goal_kobo_nonnegative CHECK (goal_kobo >= 0);
  END IF;
END $$;

COMMIT;
