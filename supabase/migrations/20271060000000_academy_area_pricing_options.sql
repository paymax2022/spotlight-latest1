-- Film Academy — composite tuition pricing per area of interest.
--
-- The single per-area fee_ngn is retired as what applicants are priced on.
-- Every area is now offered in five formats — weekend (Sat & Sun) with and
-- without boarding, weekdays (Mon–Fri) with and without boarding, and a
-- 30-day full-time format with boarding for non-Lagos residents — and the
-- SAME structure applies to every area. One row per (area × format).
--
-- ADDITIVE ONLY: a new table, defaults for every existing area, and one
-- nullable column on academy_applications. fee_ngn stays exactly as it is;
-- historic rows and the legacy per-area total keep resolving against it.

CREATE TABLE IF NOT EXISTS public.academy_area_pricing_options (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id    uuid NOT NULL REFERENCES public.academy_interest_areas(id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key IN (
               'weekend_day', 'weekend_boarding', 'weekday_day',
               'weekday_boarding', 'full_time_boarding')),
  label      text NOT NULL,
  note       text,
  price_ngn  numeric(12,2) NOT NULL CHECK (price_ngn >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, key)
);

CREATE INDEX IF NOT EXISTS academy_area_pricing_options_area_idx
  ON public.academy_area_pricing_options (area_id, sort_order);

COMMENT ON TABLE  public.academy_area_pricing_options IS
  'Film Academy tuition per area of interest, per training format (NAIRA). Replaces fee_ngn as the priced structure.';
COMMENT ON COLUMN public.academy_area_pricing_options.price_ngn IS
  'Naira, not kobo — same convention as academy_interest_areas.fee_ngn.';

-- Launch structure, identical for every area:
--   weekend, no boarding ₦50k · weekend, boarding ₦80k
--   weekday, no boarding ₦100k · weekday, boarding ₦150k
--   full-time 30 days, boarding (non-Lagos residents) ₦200k
INSERT INTO public.academy_area_pricing_options (area_id, key, label, note, price_ngn, sort_order)
SELECT a.id, f.key, f.label, f.note, f.price_ngn, f.sort_order
FROM public.academy_interest_areas a
CROSS JOIN (VALUES
  ('weekend_day',        'Weekend — Saturday & Sunday', 'No boarding',                50000,  10),
  ('weekend_boarding',   'Weekend — Saturday & Sunday', 'With boarding',              80000,  20),
  ('weekday_day',        'Week days — Monday to Friday', 'No boarding',               100000, 30),
  ('weekday_boarding',   'Week days — Monday to Friday', 'With boarding',             150000, 40),
  ('full_time_boarding', 'Full time — 1 month (30 days)', 'With boarding · for non-Lagos residents', 200000, 50)
) AS f(key, label, note, price_ngn, sort_order)
ON CONFLICT (area_id, key) DO NOTHING;

-- The format an application was priced in, so the frozen tuition_total_ngn can
-- be explained after the fact even if the structure is repriced later.
ALTER TABLE public.academy_applications
  ADD COLUMN IF NOT EXISTS pricing_option_key text;

COMMENT ON COLUMN public.academy_applications.pricing_option_key IS
  'academy_area_pricing_options.key the tuition was priced in. NULL = legacy fee_ngn sum.';

-- Same posture as academy_interest_areas: pricing is only ever served through
-- the BFF, never read raw by clients.
ALTER TABLE public.academy_area_pricing_options ENABLE ROW LEVEL SECURITY;
