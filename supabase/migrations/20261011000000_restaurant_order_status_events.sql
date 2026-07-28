-- Additive: per-transition audit trail for restaurant / food-delivery orders.
-- Closes plan invariant #3 (every state change writes an audit event with actor,
-- timestamp, from→to) — SEC-010 / OL-005 in the Restaurant & Delivery test plan.
-- Append-only; no existing object is modified. New table + index only.

CREATE TABLE IF NOT EXISTS public.restaurant_order_status_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID        NOT NULL,
    actor_id    TEXT,                       -- the user who drove the transition (nullable for system)
    from_status TEXT,                       -- nullable: unknown/none
    to_status   TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_order_status_events_order
    ON public.restaurant_order_status_events (order_id, created_at);
