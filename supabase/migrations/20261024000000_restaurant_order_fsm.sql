-- Restaurant / Delivery — expanded order lifecycle (Phase 14, additive-only).
-- Adds rejected / dispatch_failed / delivery_failed to the order status CHECK (superset
-- of the existing set — every current row still satisfies it) + a status_reason note.
-- rejected & dispatch_failed refund the escrow (money paths); delivery_failed is a
-- marker resolved via cancel/dispute. No DROP / RENAME / type narrowing.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check') THEN
        ALTER TABLE orders DROP CONSTRAINT orders_status_check;
    END IF;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
        ('pending','confirmed','preparing','ready','picked_up','delivered','cancelled',
         'rejected','dispatch_failed','delivery_failed'));
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_reason TEXT;
