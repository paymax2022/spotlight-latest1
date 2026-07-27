-- Restaurant / Delivery — dispatch SLA timeline (Phase 7, additive-only).
--
-- Records the rider-sourcing timeline so time-to-assign can be measured and breaches
-- surfaced to ops: when the order was first offered to riders, when a rider was
-- assigned, and how many (escalating) dispatch attempts it took. ready_at already
-- exists (autodispatch migration). No DROP / RENAME / type narrowing.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS first_offered_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_at       TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_attempts INT NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0);

-- Ops query: still-searching orders ordered by how long they've been waiting.
CREATE INDEX IF NOT EXISTS orders_dispatch_searching_idx
    ON orders (dispatch_status, ready_at)
    WHERE dispatch_status = 'searching';
