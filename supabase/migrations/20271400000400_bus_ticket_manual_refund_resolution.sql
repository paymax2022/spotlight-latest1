-- Ops resolution of bus tickets parked at refund_status='manual_required'
-- (fare already settled to the operator). Additive only.
-- manual_refund_method is claimed BEFORE any money moves and is sticky, so an
-- offline resolve can never race an in-flight wallet refund.

ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_method TEXT
    CHECK (manual_refund_method IN ('wallet_refund','offline'));
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_claimed_at TIMESTAMPTZ;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_idempotency_key TEXT;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_reference TEXT;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_reason TEXT;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_resolved_by UUID;
ALTER TABLE bus_tickets ADD COLUMN IF NOT EXISTS manual_refund_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bus_tickets_manual_refund_queue_idx
    ON bus_tickets(created_at DESC) WHERE refund_status = 'manual_required';
