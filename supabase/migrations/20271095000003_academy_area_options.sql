-- Film Academy — priced options per area of interest.
--
-- Each area can have multiple options with different schedules and boarding choices.
-- An option defines the schedule and has two prices: with and without boarding.
-- Boarding price can be NULL to indicate boarding is not offered for that option.
--
-- ADDITIVE ONLY: new table and new column on academy_applications.

CREATE TABLE IF NOT EXISTS public.academy_area_options (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id         uuid NOT NULL REFERENCES public.academy_interest_areas(id) ON DELETE CASCADE,
  label           text NOT NULL,
  duration_label  text,
  price_no_boarding_ngn bigint NOT NULL CHECK (price_no_boarding_ngn >= 0),
  price_with_boarding_ngn bigint CHECK (price_with_boarding_ngn >= 0),
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_area_options_area_idx
  ON public.academy_area_options (area_id, sort_order);

COMMENT ON TABLE  public.academy_area_options IS
  'Film Academy tuition options per area of interest. Each option has a schedule (label) and pricing (with/without boarding). NAIRA amounts.';
COMMENT ON COLUMN public.academy_area_options.label IS
  'Schedule/format name, e.g. "Weekend" or "Weekdays".';
COMMENT ON COLUMN public.academy_area_options.duration_label IS
  'Optional duration hint, e.g. "4 weeks".';
COMMENT ON COLUMN public.academy_area_options.price_no_boarding_ngn IS
  'Naira, not kobo — same convention as academy_interest_areas.fee_ngn.';
COMMENT ON COLUMN public.academy_area_options.price_with_boarding_ngn IS
  'Naira. NULL means boarding is not offered for this option.';

-- Snapshot of selections: [{area_slug, option_id, label, duration_label, boarding, price_ngn}]
-- Immutable across price edits so tuition_total_ngn never changes after application.
ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS selected_options jsonb;

COMMENT ON COLUMN public.academy_applications.selected_options IS
  'Snapshot array of chosen options per area. Immutable after application to freeze tuition.';

-- Tuition total in naira (sum of chosen option prices).
ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS tuition_total_ngn numeric(12,2);

COMMENT ON COLUMN public.academy_applications.tuition_total_ngn IS
  'Sum of chosen option prices at application time. Never updated after creation.';

-- Enable RLS per academy convention.
ALTER TABLE public.academy_area_options ENABLE ROW LEVEL SECURITY;
