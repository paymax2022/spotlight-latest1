-- Film Academy — the training formats become operator-managed.
--
-- Until now the formats an applicant chooses between — "Weekend (No Boarding)",
-- "Weekend (With Boarding)", "Week days (No Boarding)", "Week days (Boarding)",
-- "1 month - Boarding" — were a hardcoded contract written down three times:
-- a CHECK listing exactly those five literals on
-- academy_area_pricing_options.key, the same five in
-- frontend-web/src/server/services/academy/pricing.ts (ACADEMY_PRICING_STRUCTURE),
-- and again as a TypeScript union in the admin portal. The console could change
-- a PRICE and nothing else: renaming a label (including a typo a learner sees),
-- reordering, retiring a format or adding one took a migration and a deploy.
--
-- This makes the format list an entity of its own.
--
--   academy_pricing_formats        format identity, once: key, label, note,
--                                  order, whether it is on offer, and the price
--                                  a newly created training starts at
--   academy_area_pricing_options   unchanged in shape — one row per
--                                  (training × format) holding that training's
--                                  price, with label/note/sort kept as a copy
--                                  the admin API re-syncs on every rename
--
-- ADDITIVE, plus one constraint swap:
--
-- 1. The new table is seeded FROM THE ROWS THAT ALREADY EXIST, not from the
--    constants. Whatever wording and prices the environment is actually serving
--    become the managed defaults, so the first render after this migration is
--    byte-identical to the last render before it.
--
-- 2. The five-literal CHECK is dropped and replaced by (a) a key-pattern CHECK —
--    lowercase, starts with a letter, so a malformed key cannot reach the money
--    path — and (b) a foreign key to academy_pricing_formats, so a typo in an
--    insert is refused while any format the admin defines is accepted.
--
-- 3. Retiring a format NEVER deletes rows. academy_applications.pricing_option_key
--    and .pricing_selections store the key forever, and
--    GET /api/academy/application resolves the label a learner was charged under
--    out of these rows; dropping them would rewrite a paid learner's receipt.
--    The RESTRICT-side FK is what enforces that at the database: a format with
--    priced rows under it cannot be removed until the API has first proved no
--    application references it.
--
-- Mirrors frontend-web/src/server/services/academy/pricing.ts, which keeps its
-- five launch rows only as the seed for an environment with no formats table
-- (a fresh local database) and as the shape new trainings are priced in.

CREATE TABLE IF NOT EXISTS public.academy_pricing_formats (
  key               text PRIMARY KEY
                    CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label             text NOT NULL CHECK (label <> ''),
  note              text,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  -- What a training gets when it has no row for this format yet: a newly
  -- created training, or a format added after the trainings already existed.
  -- Strictly positive for the same reason the per-area price is — a 0
  -- tuition_total_ngn makes the tuition services fall back to the batch
  -- training_fee_ngn, a figure the applicant never saw.
  default_price_ngn numeric(12,2) NOT NULL CHECK (default_price_ngn > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.academy_pricing_formats IS
  'Film Academy training formats an applicant can choose (the "Weekend (No Boarding)" list). Managed from /admin/academy/film → Settings; identity lives here once, money lives per training in academy_area_pricing_options.';
COMMENT ON COLUMN public.academy_pricing_formats.key IS
  'Written into academy_applications.pricing_option_key and .pricing_selections, so it is the contract: renaming a label is safe, changing a key is not. The admin API refuses a key change on update, same as academy_interest_areas refuses a slug change.';
COMMENT ON COLUMN public.academy_pricing_formats.label IS
  'The wording the applicant sees, e.g. "Weekend (No Boarding)". A rename re-syncs academy_area_pricing_options.label for every training.';
COMMENT ON COLUMN public.academy_pricing_formats.is_active IS
  'false = withdrawn from new applications. Never delete a format rows exist for: past applications price and label themselves from those rows.';
COMMENT ON COLUMN public.academy_pricing_formats.default_price_ngn IS
  'Naira, not kobo — same convention as academy_area_pricing_options.price_ngn. The price a training is given when it has no row for this format yet.';

-- Seed from the live rows: the newest-worded label per key, and the cheapest
-- price actually charged for it across trainings. Deterministic ordering
-- (sort_order, then area_id) so a replay produces the same rows.
INSERT INTO public.academy_pricing_formats (key, label, note, sort_order, is_active, default_price_ngn)
SELECT picked.key, picked.label, picked.note, picked.sort_order, true, priced.min_price_ngn
FROM (
  SELECT DISTINCT ON (key) key, label, note, sort_order
  FROM public.academy_area_pricing_options
  ORDER BY key, sort_order, area_id
) AS picked
JOIN (
  SELECT key, MIN(price_ngn) AS min_price_ngn
  FROM public.academy_area_pricing_options
  GROUP BY key
) AS priced USING (key)
ON CONFLICT (key) DO NOTHING;

-- Same posture as academy_area_pricing_options and academy_interest_areas: the
-- catalogue is only ever served through the BFF, never read raw by a browser.
ALTER TABLE public.academy_pricing_formats ENABLE ROW LEVEL SECURITY;

-- The inline CHECK in 20271060000000 was named by Postgres. All three steps are
-- guarded on pg_constraint so a replay is a no-op rather than an error —
-- ADD CONSTRAINT has no IF NOT EXISTS form, and a half-applied environment is
-- repaired by running the file again instead of hand-edited.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.academy_area_pricing_options'::regclass
      AND conname = 'academy_area_pricing_options_key_check'
  ) THEN
    ALTER TABLE public.academy_area_pricing_options
      DROP CONSTRAINT academy_area_pricing_options_key_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.academy_area_pricing_options'::regclass
      AND conname = 'academy_area_pricing_options_key_pattern_check'
  ) THEN
    ALTER TABLE public.academy_area_pricing_options
      ADD CONSTRAINT academy_area_pricing_options_key_pattern_check
      CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$');
  END IF;

  -- RESTRICT (the default) is the point: the rows per training are what a
  -- historic application explains itself with.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.academy_area_pricing_options'::regclass
      AND conname = 'academy_area_pricing_options_key_fkey'
  ) THEN
    ALTER TABLE public.academy_area_pricing_options
      ADD CONSTRAINT academy_area_pricing_options_key_fkey
      FOREIGN KEY (key) REFERENCES public.academy_pricing_formats (key);
  END IF;
END $$;

COMMENT ON COLUMN public.academy_area_pricing_options.label IS
  'Copy of academy_pricing_formats.label, re-synced by the admin API on every rename so a per-application read (GET /api/academy/application) still resolves the wording that was charged without joining the catalogue.';
