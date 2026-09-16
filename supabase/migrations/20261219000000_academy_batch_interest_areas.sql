-- Film Academy — which areas of interest each batch offers.
--
-- The CATALOGUE and its prices stay in academy_interest_areas: Cinematography
-- costs the same in every cohort, and there is one place to change it. A batch
-- only chooses WHICH of them it offers, so a directing intake need not list
-- sound.
--
-- ADDITIVE ONLY. No existing table is altered.
--
-- EMPTY MEANS UNRESTRICTED. A batch with no rows here offers every active area,
-- so the three batches already on staging keep working untouched and
-- restricting is opt-in. This is why the join table carries no NOT NULL
-- back-reference and no seed: absence is a meaningful, safe default.

CREATE TABLE IF NOT EXISTS public.academy_batch_interest_areas (
  batch_id   uuid NOT NULL REFERENCES public.academy_batches(id) ON DELETE CASCADE,
  -- References the catalogue by SLUG, the same value applications store.
  area_slug  text NOT NULL REFERENCES public.academy_interest_areas(slug) ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, area_slug)
);

-- The applicant query is "areas for this batch"; the PK covers it. This index
-- serves the reverse — "which batches offer this area" — which the admin needs
-- before retiring one.
CREATE INDEX IF NOT EXISTS academy_batch_interest_areas_slug_idx
  ON public.academy_batch_interest_areas (area_slug);

COMMENT ON TABLE public.academy_batch_interest_areas IS
  'Which areas a batch offers. NO ROWS = offers every active area (unrestricted).';
COMMENT ON COLUMN public.academy_batch_interest_areas.area_slug IS
  'FK to academy_interest_areas.slug — the same value applications store.';
