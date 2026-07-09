-- Migration: stays_saved_guests — member's saved guest / traveller profiles.
-- Additive only: a new table. Lets a member store fellow-traveller details for
-- fast checkout prefill. Non-money, non-PII-critical (name/email/phone). Scoped
-- per member by RLS.

CREATE TABLE IF NOT EXISTS public.stays_saved_guests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  full_name  text NOT NULL,
  email      text NOT NULL DEFAULT '',
  phone      text NOT NULL DEFAULT '',
  is_lead    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stays_saved_guests_user_created
  ON public.stays_saved_guests (user_id, created_at);

ALTER TABLE public.stays_saved_guests ENABLE ROW LEVEL SECURITY;

-- A member may only see and mutate their own saved guests.
DO $$ BEGIN
  CREATE POLICY "stays_saved_guests_own" ON public.stays_saved_guests
    FOR ALL TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
