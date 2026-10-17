-- Parcel rate card: price per size × delivery speed, admin-editable.
--
-- ADDITIVE-ONLY. One new table, plus two CHECK constraints on public.parcels
-- WIDENED (drop + re-add with a superset — the established widening pattern;
-- every value accepted before is still accepted).
--
-- 1. transport_parcel_rate_card — one row per (zone, size, speed): a fare
--    multiplier in basis points applied to the distance/time base from
--    transport_pricing_config, and a minimum fare for that combination. Read by
--    the Go transport service when FEATURE_PARCEL_RATE_CARD_ENABLED is on; a
--    missing row falls back to the legacy hardcoded multipliers.
--
-- 2. parcels.speed: the app offers Standard / Express / Priority and sends
--    Priority as 'same_day', which the original CHECK did not allow — every
--    Priority booking failed at INSERT.
--
-- 3. parcels.category: the app sends 'documents', 'clothing' and 'other'; the
--    original CHECK only knew 'document', 'fashion' and 'custom', so the
--    app's DEFAULT selection (documents) could not be booked either.

CREATE TABLE IF NOT EXISTS public.transport_parcel_rate_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone           text NOT NULL DEFAULT 'default',
  size           text NOT NULL CHECK (size IN ('small','medium','large')),
  speed          text NOT NULL CHECK (speed IN ('standard','express','same_day','scheduled')),
  multiplier_bps bigint NOT NULL CHECK (multiplier_bps BETWEEN 1000 AND 100000),
  min_fare_kobo  bigint NOT NULL DEFAULT 0 CHECK (min_fare_kobo >= 0),
  active         boolean NOT NULL DEFAULT true,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone, size, speed)
);

-- Defaults for the 'default' zone. Multipliers keep the old size × speed
-- ratios (small 1.0 / medium 1.4 / large 2.0 × standard 1.0 / express 1.5 /
-- scheduled 0.9), with Priority at 2.2× and a larger box needing a bigger
-- vehicle. The minimum fare now rises with size AND speed, so a short hop no
-- longer prices Priority on a large box the same as Standard on an envelope.
INSERT INTO public.transport_parcel_rate_card (zone, size, speed, multiplier_bps, min_fare_kobo) VALUES
  ('default', 'small',  'standard',  10000, 100000),
  ('default', 'small',  'express',   15000, 180000),
  ('default', 'small',  'same_day',  22000, 300000),
  ('default', 'small',  'scheduled',  9000, 100000),
  ('default', 'medium', 'standard',  14000, 150000),
  ('default', 'medium', 'express',   21000, 250000),
  ('default', 'medium', 'same_day',  30000, 400000),
  ('default', 'medium', 'scheduled', 12600, 135000),
  ('default', 'large',  'standard',  20000, 250000),
  ('default', 'large',  'express',   30000, 400000),
  ('default', 'large',  'same_day',  42000, 600000),
  ('default', 'large',  'scheduled', 18000, 225000)
ON CONFLICT (zone, size, speed) DO NOTHING;

-- Backend-only table: reached through the Go service, never the public API.
ALTER TABLE public.transport_parcel_rate_card ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'transport_parcel_rate_card' AND policyname = 'parcel_rate_card_service') THEN
    CREATE POLICY "parcel_rate_card_service" ON public.transport_parcel_rate_card
      TO service_role USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;

ALTER TABLE public.parcels DROP CONSTRAINT IF EXISTS parcels_speed_check;
ALTER TABLE public.parcels ADD CONSTRAINT parcels_speed_check
  CHECK (speed IN ('standard','express','scheduled','same_day'));

ALTER TABLE public.parcels DROP CONSTRAINT IF EXISTS parcels_category_check;
ALTER TABLE public.parcels ADD CONSTRAINT parcels_category_check
  CHECK (category IN ('document','small','medium','large','fragile','food','electronics','fashion','custom',
                      'documents','clothing','other'));
