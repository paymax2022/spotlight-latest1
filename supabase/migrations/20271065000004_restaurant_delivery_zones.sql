-- FOOD-UAT-C-003: delivery serviceability zones. Additive-only.
-- Distances are stored in "km_bps" = kilometres x 10000 (integer, no floats).
-- No zone rows and NULL max_delivery_km_bps = permissive (legacy behaviour).
BEGIN;
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS max_delivery_km_bps INT NULL;

CREATE TABLE IF NOT EXISTS public.restaurant_delivery_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('radius_km','polygon')),
  radius_km_bps   INT NULL,
  polygon_geojson JSONB NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT NULL,
  CONSTRAINT restaurant_delivery_zones_shape CHECK (
    (kind = 'radius_km' AND radius_km_bps IS NOT NULL AND radius_km_bps > 0 AND polygon_geojson IS NULL)
    OR (kind = 'polygon' AND polygon_geojson IS NOT NULL AND radius_km_bps IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_restaurant_delivery_zones_restaurant
  ON public.restaurant_delivery_zones (restaurant_id);
COMMIT;
