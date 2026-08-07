-- ─────────────────────────────────────────────────────────────────────────────
-- insurance_products: self-describing display metadata for browse cards.
--
-- ADDITIVE-ONLY. ADD COLUMN (nullable-with-default) + UPDATE of known seed codes.
-- No DROP, no rename, no type narrowing. Re-runnable.
--
-- Why columns and not a frontend map: the indicative "from" premium varies per
-- product (not per line — e.g. the two MOTOR products differ), and premium
-- cadence is per-product too (health/PA are monthly, device/SME annual). Keeping
-- them in the catalog honours the iron rule "no product data hard-coded in logic"
-- and lets the mobile mapper stay presentation-only. The REAL premium is still
-- computed at quote time by the provider adapter — these are indicative only.
--
-- IRON RULE: indicative_premium_kobo is an integer in minor units (kobo).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.insurance_products
  ADD COLUMN IF NOT EXISTS indicative_premium_kobo bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_cadence         text   NOT NULL DEFAULT 'annual';

-- Indicative "from" premium + cadence for the 7 seeded catalog products.
UPDATE public.insurance_products AS p SET
  indicative_premium_kobo = v.premium_kobo,
  premium_cadence         = v.cadence
FROM (VALUES
  ('mycover.health.micro.v1',          120000,  'monthly'),
  ('mycover.pa.income.v1',              50000,   'monthly'),
  ('mycover.device.gadget.v1',          80000,   'annual'),
  ('mycover.sme.bundle.v1',             350000,  'annual'),
  ('octamile.motor.comprehensive.v1',   2500000, 'annual'),
  ('octamile.motor.thirdparty.v1',      1500000, 'annual'),
  ('octamile.git.parcel.v1',            20000,   'per-shipment')
) AS v(code, premium_kobo, cadence)
WHERE p.code = v.code;
