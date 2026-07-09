-- Migration: stays_saved — member wishlist for the Stays module.
-- Additive only: a new table. A saved entry is keyed by the opaque composite
-- property key the mobile client threads through the UI (rail + supplier + ref +
-- card essentials). One row per (user, property_key); toggling deletes/re-inserts.

CREATE TABLE IF NOT EXISTS public.stays_saved (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  property_key text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_key)
);

CREATE INDEX IF NOT EXISTS idx_stays_saved_user_created
  ON public.stays_saved (user_id, created_at DESC);

ALTER TABLE public.stays_saved ENABLE ROW LEVEL SECURITY;

-- A member may only see and mutate their own wishlist rows.
DO $$ BEGIN
  CREATE POLICY "stays_saved_own" ON public.stays_saved
    FOR ALL TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
