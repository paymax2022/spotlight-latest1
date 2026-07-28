-- Additive-only: bring the legacy user_profiles table up to the shape the profile
-- code already reads and writes (mobile getProfile SELECT + server updateUserProfile
-- widePayload + normalizeProfile). Without these columns the wide upsert fails and
-- silently falls back to writing only {id,email,role}, so date_of_birth (and the
-- other details) never persist — the mobile profile form then repopulates blank and
-- Tier 0 reports "date of birth not provided".
--
-- No DROP / RENAME / type-narrowing. All columns nullable (jsonb/text[] defaulted).
-- Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS first_name          text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS last_name           text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS display_name        text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS whatsapp            text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS country             text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS city                text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS metadata            jsonb   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS social              jsonb   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS identity            jsonb   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS specialist_profiles jsonb   NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS profile_types       jsonb   NOT NULL DEFAULT '["general_applicant"]'::jsonb;
