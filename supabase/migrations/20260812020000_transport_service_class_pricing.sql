-- Seed per-service-class pricing for ride hailing.
--
-- The mobile client requests estimates with service_type ∈ (economy, comfort,
-- premium, xl) — the rider-facing service classes — but 20260623000000 only
-- seeded zone=default/service=ride_hailing, so every live estimate failed with
-- "pricing config not found for zone=default service=<class>".
--
-- Additive + idempotent: inserts the four class rows, tiered off the
-- ride_hailing defaults (base ₦500, per-km ₦120, per-min ₦25, min ₦1500).
-- Values are admin-tunable afterwards via PATCH /api/finance/admin/transport/pricing.

INSERT INTO public.transport_pricing_config
  (zone, service_type, base_fare_kobo, per_km_kobo, per_min_kobo, min_fare_kobo)
VALUES
  ('default', 'economy',  50000, 12000, 2500, 150000),
  ('default', 'comfort',  62500, 15000, 3200, 187500),
  ('default', 'xl',       70000, 16800, 3500, 210000),
  ('default', 'premium',  80000, 19200, 4000, 240000)
ON CONFLICT (zone, service_type) DO NOTHING;
