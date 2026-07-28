-- Restaurant / Delivery — pricing v2: service fee, item surge, free-delivery promo
-- (Phase 10, additive-only). No VAT (out of scope by product decision).
--
-- Money model:
--   * surge  (surge_bp) inflates the item subtotal → part of the settlement GROSS,
--     split 80/10/10 like any food revenue (peak dynamic pricing).
--   * service fee (service_fee_bp) is a fixed PLATFORM leg at settlement
--     (settlement.Split.ServiceFeeKobo — 100% platform, the mirror of a rider tip).
--   * free_delivery promo zeroes the delivery fee as a platform-funded discount.
-- All are platform/ops-controlled (basis points, default 0 ⇒ no change; every existing
-- restaurant/order is unaffected). No DROP / RENAME / type narrowing.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_fee_bp INT NOT NULL DEFAULT 0
    CHECK (service_fee_bp BETWEEN 0 AND 10000);   -- 0–100% of subtotal
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS surge_bp INT NOT NULL DEFAULT 0
    CHECK (surge_bp BETWEEN 0 AND 50000);          -- 0–5x surge on the item subtotal

ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_fee_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (service_fee_kobo >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS surge_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (surge_kobo >= 0);

-- Widen the promo kind CHECK to add 'free_delivery' (additive superset: drop + re-add
-- the named constraint with the extended set; every existing value still satisfies it).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_promos_kind_check') THEN
        ALTER TABLE restaurant_promos DROP CONSTRAINT restaurant_promos_kind_check;
    END IF;
    ALTER TABLE restaurant_promos
        ADD CONSTRAINT restaurant_promos_kind_check CHECK (kind IN ('percent','fixed','free_delivery'));
END $$;
