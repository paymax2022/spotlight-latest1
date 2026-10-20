-- FOOD-UAT-C-012 / D-007: persist the delivery pin + recipient contact on the order,
-- and lay the order_type foundation (delivery | pickup_now | pickup_scheduled | dine_in).
-- Additive-only: new nullable/defaulted columns, and orders_status_check WIDENED to a
-- superset (adds 'served','closed' for dine-in) so every existing row still satisfies it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude        DECIMAL(10,7);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude       DECIMAL(10,7);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_landmark        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_recipient_phone TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type   TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;  -- exists since 20261026; no-op
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_type_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_order_type_check
            CHECK (order_type IN ('delivery','pickup_now','pickup_scheduled','dine_in'));
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check') THEN
        ALTER TABLE orders DROP CONSTRAINT orders_status_check;
    END IF;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
        ('pending','confirmed','preparing','ready','picked_up','delivered','cancelled',
         'rejected','dispatch_failed','delivery_failed','chargebacked','served','closed'));
END $$;
