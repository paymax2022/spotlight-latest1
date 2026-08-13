-- Restaurant / Delivery — rider tip clawback on post-settlement food disputes
-- (additive-only). See docs/adr/ADR-031-dispute-refund-caps-and-funding.md.
--
-- Context: once the customer tip became real (escrowed in orders.total_kobo, paid 100%
-- to the rider at settlement), the post-settlement dispute refund path was refunding a
-- tip the platform never held. Disputes resolve only on DELIVERED orders — i.e. AFTER
-- settlement already paid the rider — so a full refund of the tip-inclusive total made
-- the platform fund the rider's tip out of its own revenue.
--
-- Policy: the platform-funded refund is capped at the NON-TIP basis (total − tip). The
-- tip is refunded to the customer separately and is funded by the RIDER, not the
-- platform: on a full refund the rider's wallet is debited for the tip and the customer
-- credited in the same balanced pair. When the rider's wallet cannot cover it (they have
-- already withdrawn), the obligation is recorded here as PENDING and recovered off their
-- next delivery settlement, at which point the customer is credited.
--
-- This table is the durable record of that obligation. It is NOT a ledger account: no
-- money is represented by a row, only the intent to move it. All actual movement is
-- balanced ledger_entries keyed on 'dispute-tip-clawback:<dispute_id>'.
--
-- Additive only — no DROP / RENAME / type narrowing.

CREATE TABLE IF NOT EXISTS restaurant_dispute_tip_clawbacks (
    dispute_id   TEXT PRIMARY KEY,          -- shared disputes.id — one clawback per ticket (idempotent)
    order_id     UUID NOT NULL REFERENCES orders(id),
    rider_id     UUID NOT NULL,             -- the rider who was paid the tip at settlement
    customer_id  UUID NOT NULL,             -- the disputing customer the tip is owed back to
    tip_kobo     BIGINT NOT NULL CHECK (tip_kobo > 0),
    -- pending  → the rider's wallet could not cover it; recover off their next settlement
    -- recovered→ the balanced DR rider / CR customer pair has been posted
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'recovered')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_at TIMESTAMPTZ,
    -- A recovered row must carry its timestamp, and a pending row must not — keeps the
    -- projection honest if a future writer forgets one half of the flip.
    CONSTRAINT restaurant_dispute_tip_clawbacks_recovered_at_ck
        CHECK ((status = 'recovered') = (recovered_at IS NOT NULL))
);

-- ONE clawback per ORDER, ever — the hard guarantee against double-debiting a rider.
-- The dispute_id primary key alone is not enough: the shared `disputes` table only blocks
-- a second CONCURRENTLY ACTIVE ticket on an order (status in open/investigating), and
-- orders.disputed_at is a marker rather than a gate, so once a dispute resolves a second
-- one is raisable on the same delivered order. Keyed only by dispute id, that second
-- ticket would mint a fresh idempotency key and debit the rider the same tip a second
-- time while crediting the customer twice. The tip comes back at most once.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_dispute_tip_clawbacks_order_uniq
    ON restaurant_dispute_tip_clawbacks (order_id);

-- The recovery sweep runs per rider at settlement and only ever looks at open debts.
CREATE INDEX IF NOT EXISTS restaurant_dispute_tip_clawbacks_pending_idx
    ON restaurant_dispute_tip_clawbacks (rider_id, created_at)
    WHERE status = 'pending';

ALTER TABLE restaurant_dispute_tip_clawbacks ENABLE ROW LEVEL SECURITY;
-- Money/decision data: no client policy. The Go service (admin-gated dispute resolve and
-- the settlement recovery sweep) is the only writer; reads go through the service.
