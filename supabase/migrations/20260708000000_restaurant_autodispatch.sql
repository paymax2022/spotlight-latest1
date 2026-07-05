-- Restaurant delivery auto-dispatch + handoff confirmation.
-- Additive-only. No DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
--
-- When a restaurant marks an order "ready", the engine auto-offers the delivery
-- to the nearest available riders (transport `drivers` pool: status='online',
-- verification_status='approved'). The first rider to accept wins. At drop-off
-- the rider confirms handoff with the customer's delivery code.

-- ── orders: dispatch + handoff columns ───────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_code   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at        TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at    TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at    TIMESTAMPTZ;

-- dispatch_status lifecycle: none → searching → assigned → delivered.
-- Added as a NOT VALID-friendly soft constraint via a CHECK that tolerates all
-- existing rows (default 'none'). Use a named check; additive.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_dispatch_status_chk'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_dispatch_status_chk
      CHECK (dispatch_status IN ('none','searching','assigned','delivered'));
  END IF;
END$$;

-- ── restaurant_delivery_offers: multi-candidate auto-dispatch ─────────────────
-- One row per (order, rider) the delivery was offered to. The first rider to
-- accept transitions their offer to 'accepted'; the rest are 'expired'.
CREATE TABLE IF NOT EXISTS restaurant_delivery_offers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID        NOT NULL REFERENCES orders(id),
  rider_id     UUID        NOT NULL REFERENCES auth.users(id),
  status       TEXT        NOT NULL DEFAULT 'offered'
                           CHECK (status IN ('offered','accepted','declined','expired')),
  distance_m   DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT restaurant_delivery_offers_uniq UNIQUE (order_id, rider_id)
);

CREATE INDEX IF NOT EXISTS restaurant_delivery_offers_order_idx  ON restaurant_delivery_offers(order_id);
CREATE INDEX IF NOT EXISTS restaurant_delivery_offers_rider_idx  ON restaurant_delivery_offers(rider_id, status);

ALTER TABLE restaurant_delivery_offers ENABLE ROW LEVEL SECURITY;

-- A rider sees offers addressed to them; service_role manages writes.
DROP POLICY IF EXISTS "restaurant_delivery_offers_rider_select" ON restaurant_delivery_offers;
CREATE POLICY "restaurant_delivery_offers_rider_select"
  ON restaurant_delivery_offers FOR SELECT
  USING (auth.uid() = rider_id);

DROP POLICY IF EXISTS "restaurant_delivery_offers_service_role" ON restaurant_delivery_offers;
CREATE POLICY "restaurant_delivery_offers_service_role"
  ON restaurant_delivery_offers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
