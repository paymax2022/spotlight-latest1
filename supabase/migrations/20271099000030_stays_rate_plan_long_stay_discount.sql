-- Creator-set long-stay discount on a rate plan: bookings of at least
-- long_stay_min_nights nights get long_stay_discount_pct percent off the room total.
-- Additive only. Defaults mean no discount for every existing plan.

ALTER TABLE public.stays_rate_plan
  ADD COLUMN IF NOT EXISTS long_stay_min_nights integer NULL
    CHECK (long_stay_min_nights IS NULL OR long_stay_min_nights > 0),
  ADD COLUMN IF NOT EXISTS long_stay_discount_pct integer NOT NULL DEFAULT 0
    CHECK (long_stay_discount_pct BETWEEN 0 AND 100);

COMMENT ON COLUMN public.stays_rate_plan.long_stay_min_nights IS
  'Nights at or above which long_stay_discount_pct applies. NULL = no long-stay rule.';
COMMENT ON COLUMN public.stays_rate_plan.long_stay_discount_pct IS
  'Percent off the room total for stays of long_stay_min_nights or more (0-100).';
