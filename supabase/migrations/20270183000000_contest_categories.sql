-- Contest categories become data instead of a hardcoded list.
--
-- Until now "competition category" existed in three hardcoded places and nowhere
-- an admin could reach:
--   1. the ContestCategory union in frontend-web/src/features/registration/types.ts
--   2. `allowedCategories` in app/api/admin/contests/route.ts AND
--      app/api/admin/contests/[slug]/route.ts — the actual gate, which 400s
--      "Invalid contest category." for anything off the list
--   3. the CATEGORIES const rendered by the admin create page
-- contests.category itself is plain TEXT with no CHECK constraint, so the
-- database never restricted anything: the whole limitation was those consts.
--
-- Additive only: no change to contests, and nothing here drops or narrows.
-- Existing rows keep whatever category string they hold (today that includes
-- 'Talent', 'SME Pitch', 'Film' and 26 empty strings, none of which were ever in
-- the allow-list either — so this neither fixes nor worsens them). An admin can
-- adopt those values by creating matching categories.

CREATE TABLE IF NOT EXISTS public.contest_categories (
  -- The slug is what lands in contests.category, so it is the identity.
  slug        text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  -- Deactivating hides a category from new contests without invalidating the
  -- contests already filed under it — which is why this is a flag rather than a
  -- DELETE. Validation on create/update checks active categories only.
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contest_categories IS
  'Admin-managed list of competition categories. Replaces the hardcoded '
  'allowedCategories consts in the admin contest routes; contests.category '
  'stores the slug.';
COMMENT ON COLUMN public.contest_categories.active IS
  'False hides the category from new/edited contests without affecting contests '
  'already using it.';

CREATE INDEX IF NOT EXISTS contest_categories_active_sort_idx
  ON public.contest_categories (active, sort_order, slug);

-- Server-only, matching the rest of the admin write path: every read and write
-- goes through the Next admin routes with the service-role client, which is
-- also where the admin permission check lives. No policy is granted, so
-- PostgREST exposes nothing directly.
ALTER TABLE public.contest_categories ENABLE ROW LEVEL SECURITY;

-- Seed exactly the eleven that were hardcoded, in the order the admin page
-- rendered them, so behaviour is identical on the day this lands and the change
-- is purely "now you can add more". ON CONFLICT DO NOTHING keeps a re-run and a
-- fresh replay idempotent.
INSERT INTO public.contest_categories (slug, label, sort_order) VALUES
  ('music',                'Music',                 10),
  ('acting',               'Acting',                20),
  ('comedy_content',       'Comedy / Content',      30),
  ('dance',                'Dance',                 40),
  ('film_production',      'Film Production',       50),
  ('stem_innovation',      'STEM / Innovation',     60),
  ('sme_pitch',            'SME Pitch',             70),
  ('school_campus',        'School / Campus',       80),
  ('open_mic',             'Open Mic',              90),
  ('general_reality_show', 'General Reality Show', 100),
  ('other',                'Other',                110)
ON CONFLICT (slug) DO NOTHING;
