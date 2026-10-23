-- FOOD-UAT-H-004: Paystack dispute / chargeback / refund ingestion for food orders.
-- Additive-only. (1) widens orders_status_check with 'chargebacked' (superset of the
-- existing set — every current row still satisfies it); (2) adds the idempotency +
-- audit table keyed on the provider dispute/refund id. The ledger reversal itself is
-- the existing settlement.RefundExternal pair (ADR-040: corrections are reversing
-- entries only); this table only records that an event was seen and how it ended.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check') THEN
        ALTER TABLE orders DROP CONSTRAINT orders_status_check;
    END IF;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
        ('pending','confirmed','preparing','ready','picked_up','delivered','cancelled',
         'rejected','dispatch_failed','delivery_failed','chargebacked'));
END $$;

CREATE TABLE IF NOT EXISTS public.restaurant_order_chargebacks (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key      text NOT NULL UNIQUE,       -- 'chargeback:<dispute id>' | 'refund:<refund id>'
    kind                 text NOT NULL CHECK (kind IN ('dispute', 'refund')),
    provider_event_id    text NOT NULL,
    reference            text NOT NULL,              -- foodorder-... Paystack reference
    order_id             text,
    settlement_id        text,
    amount_kobo          bigint NOT NULL DEFAULT 0,
    -- reversed: escrow reversed via ledger | settled_unrecovered: funds already released,
    -- needs ops recovery | no_order: reference unknown | recorded: no ledger action taken
    outcome              text NOT NULL CHECK (outcome IN ('reversed', 'settled_unrecovered', 'no_order', 'recorded')),
    resolution           text,                       -- set by charge.dispute.resolve
    created_at           timestamptz NOT NULL DEFAULT now(),
    resolved_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_restaurant_order_chargebacks_reference
    ON public.restaurant_order_chargebacks (reference);
