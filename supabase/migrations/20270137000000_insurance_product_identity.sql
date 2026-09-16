-- Insurance — product identity is the provider UUID, not route_name.
--
-- ADDITIVE-ONLY: CREATE INDEX IF NOT EXISTS.
--
-- WHY: the Paymax product code was derived as `<provider>:<route_name>`, on the
-- assumption that route_name uniquely identifies a product. IT DOES NOT.
-- Verified live: two distinct MyCover products share route_name
-- "aiico-comprehensive" —
--   24140c74-fc6f-42f5-a0d2-24800b22d80a  Comprehensive Auto
--   24140c74-fc6f-42f5-a0d2-24800b22d81b  Comprehensive Auto (AAS)
-- so they collided on one catalog row and each sync silently overwrote the
-- other. 69 products went in, 68 came out, and nothing reported a problem:
-- exactly the quiet product loss the catalog design is meant to prevent.
--
-- The provider UUID is the real identity. This index makes that structural, so
-- the collision becomes impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_products_provider_product_id
  ON public.insurance_products (provider, provider_product_id)
  WHERE provider_product_id IS NOT NULL AND provider_product_id <> '';
