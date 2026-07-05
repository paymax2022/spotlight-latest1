-- Migration: restaurant_delivery_fee
-- Distance/time-based delivery-fee pricing for the restaurant module, with every
-- variable adjustable from the admin console.
-- ADDITIVE ONLY. No DROP of tables/columns, no renames, no type narrowing.
--   Fee = round((base + extra-distance + extra-time) × demand_multiplier)
--         + night_fee + weather_fee + handling_fee − promo_discount, clamped.
--   Money is BIGINT kobo. A global row (restaurant_id IS NULL) is the default;
--   an optional per-restaurant row overrides it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.restaurant_delivery_config (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid         REFERENCES public.restaurants(id) ON DELETE CASCADE, -- NULL = global default
  base_fee_kobo       bigint       NOT NULL DEFAULT 80000  CHECK (base_fee_kobo >= 0),   -- ₦800
  free_distance_km    numeric(6,2) NOT NULL DEFAULT 2.0    CHECK (free_distance_km >= 0),
  per_km_kobo         bigint       NOT NULL DEFAULT 15000  CHECK (per_km_kobo >= 0),     -- ₦150 / km after free
  free_minutes        numeric(6,2) NOT NULL DEFAULT 25.0   CHECK (free_minutes >= 0),
  per_minute_kobo     bigint       NOT NULL DEFAULT 5000   CHECK (per_minute_kobo >= 0), -- ₦50 / min after free
  demand_multiplier   numeric(5,3) NOT NULL DEFAULT 1.000  CHECK (demand_multiplier > 0),-- surge (1.0 = none)
  night_fee_kobo      bigint       NOT NULL DEFAULT 0      CHECK (night_fee_kobo >= 0),
  night_start_hour    int          NOT NULL DEFAULT 22     CHECK (night_start_hour BETWEEN 0 AND 23),
  night_end_hour      int          NOT NULL DEFAULT 5      CHECK (night_end_hour BETWEEN 0 AND 23),
  weather_fee_kobo    bigint       NOT NULL DEFAULT 0      CHECK (weather_fee_kobo >= 0),
  handling_fee_kobo   bigint       NOT NULL DEFAULT 0      CHECK (handling_fee_kobo >= 0),
  promo_discount_kobo bigint       NOT NULL DEFAULT 0      CHECK (promo_discount_kobo >= 0),
  avg_speed_kmph      numeric(6,2) NOT NULL DEFAULT 20.0   CHECK (avg_speed_kmph > 0),   -- ETA estimate
  road_factor         numeric(5,3) NOT NULL DEFAULT 1.300  CHECK (road_factor >= 1),     -- straight-line → road
  min_fee_kobo        bigint       NOT NULL DEFAULT 80000  CHECK (min_fee_kobo >= 0),    -- floor (never below base by default)
  max_fee_kobo        bigint       NOT NULL DEFAULT 0      CHECK (max_fee_kobo >= 0),    -- 0 = no cap
  active              boolean      NOT NULL DEFAULT true,
  version             int          NOT NULL DEFAULT 1,
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now()
);
-- One config per restaurant; exactly one global default (restaurant_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_delivery_config_per_restaurant
  ON public.restaurant_delivery_config (restaurant_id) WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_delivery_config_global
  ON public.restaurant_delivery_config ((restaurant_id IS NULL)) WHERE restaurant_id IS NULL;

DROP TRIGGER IF EXISTS trg_restaurant_delivery_config_updated ON public.restaurant_delivery_config;
CREATE TRIGGER trg_restaurant_delivery_config_updated BEFORE UPDATE ON public.restaurant_delivery_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.restaurant_delivery_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_delivery_config_read ON public.restaurant_delivery_config;
CREATE POLICY restaurant_delivery_config_read ON public.restaurant_delivery_config
  FOR SELECT TO anon, authenticated USING (active = true);
-- Writes via service_role (admin Go) only.

-- Persist the computed fee inputs/breakdown on the order for transparency + audit.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS distance_meters    numeric(10,1);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS eta_minutes        numeric(6,1);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed the global default config (the §formula defaults: ₦800 base, ₦150/km after
-- 2km, ₦50/min after 25min, demand 1.0).
INSERT INTO public.restaurant_delivery_config (restaurant_id) VALUES (NULL)
ON CONFLICT DO NOTHING;

COMMIT;
