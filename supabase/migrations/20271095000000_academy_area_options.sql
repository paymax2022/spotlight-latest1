-- Film Academy — per-area tuition options (schedule x with/without boarding).
--
-- Tuition is priced per OPTION under each academy interest area (e.g. "Weekend,
-- 12 weeks"), each with a no-boarding price and an optional with-boarding price.
-- See ADR-PR<pr-number>-academy-area-options (number assigned on merge).
--
-- ADDITIVE ONLY: one new table plus one nullable column. academy_interest_areas
-- and academy_applications.areas_of_interest are untouched.
--
-- MONEY: WHOLE NAIRA in bigint, not kobo. The Film Academy module predates the
-- kobo convention (academy_settings.application_fee, academy_interest_areas
-- .fee_ngn are naira); do not mix the two here.

CREATE TABLE IF NOT EXISTS public.academy_area_options (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id                     uuid NOT NULL REFERENCES public.academy_interest_areas(id),
  label                       text NOT NULL,
  duration_label              text,
  -- Price rules are the NAMED constraints added below (idempotently).
  price_no_boarding_ngn       bigint NOT NULL,
  -- NULL = boarding is not offered for this option.
  price_with_boarding_ngn     bigint,
  is_active                   boolean NOT NULL DEFAULT true,
  sort_order                  integer NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Price rules, enforced in the DB as well as the admin route (closes the PUT
-- read-then-update race):
--   * price_no_boarding_ngn > 0 — ZERO IS NOT "FREE": a zero tuition_total_ngn
--     falls back to the batch fee in the tuition services, so a ₦0 option would
--     bill the wrong amount.
--   * price_with_boarding_ngn IS NULL (boarding not offered) or >= the
--     no-boarding price (and therefore > 0) — boarding never costs less.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'academy_area_options_price_no_boarding_positive'
      AND conrelid = 'public.academy_area_options'::regclass
  ) THEN
    ALTER TABLE public.academy_area_options
      ADD CONSTRAINT academy_area_options_price_no_boarding_positive
      CHECK (price_no_boarding_ngn > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'academy_area_options_price_with_boarding_gte_no'
      AND conrelid = 'public.academy_area_options'::regclass
  ) THEN
    ALTER TABLE public.academy_area_options
      ADD CONSTRAINT academy_area_options_price_with_boarding_gte_no
      CHECK (price_with_boarding_ngn IS NULL OR price_with_boarding_ngn >= price_no_boarding_ngn);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS academy_area_options_area_sort_idx
  ON public.academy_area_options (area_id, sort_order);

COMMENT ON TABLE public.academy_area_options IS
  'Film Academy tuition options per interest area (schedule x boarding). WHOLE NAIRA. RLS enabled, no client policy: backend/service-role access only.';
COMMENT ON COLUMN public.academy_area_options.price_no_boarding_ngn IS
  'Whole naira, not kobo, > 0. Resolved server-side; never trusted from the client.';
COMMENT ON COLUMN public.academy_area_options.price_with_boarding_ngn IS
  'Whole naira, not kobo. NULL = boarding not offered; otherwise >= price_no_boarding_ngn.';

-- DENY-ALL RLS, mirroring 20261222000000_academy_interest_areas_rls.sql: every
-- reader goes through createAdminClient() (service role, bypasses RLS) and the
-- table carries unpublished pricing, so no client policy is correct.
ALTER TABLE public.academy_area_options ENABLE ROW LEVEL SECURITY;

-- The options an application chose, as resolved server-side at apply time:
-- [{area_slug, option_id, label, duration_label, boarding, price_ngn}].
-- Nullable: legacy rows stay NULL.
ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS selected_options jsonb;

COMMENT ON COLUMN public.academy_applications.selected_options IS
  'Server-resolved snapshot of chosen area options [{area_slug, option_id, label, duration_label, boarding, price_ngn}] (whole naira). NULL on pre-options applications.';
