-- Connect profile: store the details the onboarding wizard already collects.
--
-- WHY
-- The onboarding wizard asks for gender, a headline, interests and per-mode
-- preferences, and the age gate validates a date of birth — but connect_profiles
-- had no column for any of them, and the age gate never wrote dob anywhere but
-- the underage queue. completeOnboarding() therefore sent only name/bio/city, so
-- a member who filled in the whole wizard could not see most of it on their own
-- profile afterwards (and no age could be shown at all).
--
-- Photos are the same story: connect_profile_media had no ordering, so a profile
-- could not present "my first photo is my primary" or let the member reorder.
--
-- Additive only: ADD COLUMN IF NOT EXISTS with safe defaults. No DROP/RENAME.
BEGIN;

ALTER TABLE public.connect_profiles
  ADD COLUMN IF NOT EXISTS gender      text,
  ADD COLUMN IF NOT EXISTS headline    text,
  ADD COLUMN IF NOT EXISTS interests   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferences jsonb  NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.connect_profile_media
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill: give existing media a stable order (oldest first) per profile.
UPDATE public.connect_profile_media m
   SET sort_order = r.rn
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY profile_id ORDER BY created_at, id) - 1) AS rn
      FROM public.connect_profile_media
  ) r
 WHERE m.id = r.id AND m.sort_order = 0 AND r.rn > 0;

CREATE INDEX IF NOT EXISTS idx_connect_profile_media_order
  ON public.connect_profile_media (profile_id, sort_order);

COMMIT;
