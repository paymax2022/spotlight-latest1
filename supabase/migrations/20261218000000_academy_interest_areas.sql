-- Film Academy — areas of interest, priced and admin-managed.
--
-- Until now the areas were a hardcoded list in the client and a free-text
-- text[] on the application, so the mobile app offered 'Screenwriting' while
-- existing rows held 'script_writing'. One authoritative, admin-owned list ends
-- that drift and lets each area carry a fee.
--
-- ADDITIVE ONLY: new table plus a seed. academy_applications.areas_of_interest
-- (text[]) is left exactly as it is — existing rows keep working, and the slugs
-- below are seeded to MATCH the values already stored there.
--
-- MONEY: fees are NAIRA (numeric(12,2)), matching academy_settings.application_fee
-- and academy_batches.training_fee_ngn. This module predates the kobo convention
-- used across finance; do not mix the two.

CREATE TABLE IF NOT EXISTS public.academy_interest_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored on the application in areas_of_interest; must stay stable once used.
  slug        text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  -- Naira. Added to academy_settings.application_fee, which remains the base.
  fee_ngn     numeric(12,2) NOT NULL DEFAULT 0 CHECK (fee_ngn >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The applicant-facing query is "active areas in display order"; a partial index
-- keeps it off a sequential scan as the list grows.
CREATE INDEX IF NOT EXISTS academy_interest_areas_active_idx
  ON public.academy_interest_areas (sort_order, label)
  WHERE is_active;

COMMENT ON TABLE  public.academy_interest_areas IS
  'Film Academy areas of interest. Each carries a NAIRA fee added to academy_settings.application_fee.';
COMMENT ON COLUMN public.academy_interest_areas.slug IS
  'Value written to academy_applications.areas_of_interest. Stable once in use.';
COMMENT ON COLUMN public.academy_interest_areas.fee_ngn IS
  'Naira, not kobo. Summed server-side; never trusted from the client.';

-- Seed. The first three slugs MATCH values already present in
-- academy_applications so historic rows resolve against this list.
INSERT INTO public.academy_interest_areas (slug, label, description, fee_ngn, sort_order)
VALUES
  ('film_directing', 'Film Directing',  'Directing actors, coverage and visual storytelling.', 0, 10),
  ('script_writing', 'Script Writing',  'Story structure, dialogue and screenplay format.',    0, 20),
  ('acting',         'Acting',          'Performance technique for screen.',                   0, 30),
  ('cinematography', 'Cinematography',  'Camera, lensing and lighting for narrative.',         0, 40),
  ('editing',        'Editing',         'Assembly, pacing and post workflow.',                 0, 50),
  ('sound',          'Sound',           'Production sound, design and the mix.',               0, 60),
  ('producing',      'Producing',       'Scheduling, budgeting and production management.',    0, 70),
  ('production_design','Production Design','Sets, art direction and world-building.',          0, 80)
ON CONFLICT (slug) DO NOTHING;

-- Fees deliberately seed at 0 so this migration changes NOBODY's price on
-- deploy: the total stays application_fee until an admin sets real amounts.
