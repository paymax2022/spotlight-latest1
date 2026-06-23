-- Migration: Add date_of_birth and gender columns to user_profiles
-- Additive only: no DROP, no RENAME, no type changes.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS gender        TEXT
    CHECK (gender IN ('Male', 'Female'));

CREATE INDEX IF NOT EXISTS idx_user_profiles_date_of_birth
  ON public.user_profiles (date_of_birth)
  WHERE date_of_birth IS NOT NULL;
