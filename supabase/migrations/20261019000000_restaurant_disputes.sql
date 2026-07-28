-- Restaurant / Delivery — food-order dispute resolution (Phase 9, additive-only).
--
-- The dispute TICKET reuses the shared `disputes` table (module_type='food',
-- reference=order id). This migration adds only the restaurant-owned MONEY side: a
-- record of each resolved dispute's refund (keyed by dispute id for idempotency) and a
-- disputed_at marker on the order. The refund itself is a platform-funded reversing
-- ledger credit to the customer (debit paymax_revenue → credit customer wallet); it
-- never claws back the restaurant/rider, so no wallet is driven negative. Additive
-- only — no DROP / RENAME / type narrowing.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restaurant_dispute_refunds (
    dispute_id   TEXT PRIMARY KEY,           -- shared disputes.id (one resolution per ticket → idempotent)
    order_id     UUID NOT NULL REFERENCES orders(id),
    resolution   TEXT NOT NULL CHECK (resolution IN ('refund_full','refund_partial','replacement','dismissed')),
    refund_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (refund_kobo >= 0),
    resolved_by  UUID NOT NULL,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS restaurant_dispute_refunds_order_idx ON restaurant_dispute_refunds(order_id);

ALTER TABLE restaurant_dispute_refunds ENABLE ROW LEVEL SECURITY;
-- Money/decision data: no client policy; the Go service (admin-gated resolve) is the
-- only writer, and reads go through the service.
