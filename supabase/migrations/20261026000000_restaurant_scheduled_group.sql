-- Restaurant / Delivery — scheduled & group orders (Phase 18, additive-only).
--   * orders.scheduled_for → a future delivery slot (SG-001/002/005).
--   * group_orders / group_order_items → a shared cart multiple people contribute to,
--     the host finalizes into one order (SG-003/004). No DROP / RENAME / narrowing.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_scheduled_for_idx ON orders(scheduled_for)
    WHERE scheduled_for IS NOT NULL AND status = 'pending';

-- ─── group_orders ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_orders (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id               UUID NOT NULL REFERENCES auth.users(id),
    restaurant_id         UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    status                TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','locked','placed','cancelled')),
    per_contributor_cap_kobo BIGINT NOT NULL DEFAULT 0 CHECK (per_contributor_cap_kobo >= 0),
    order_id              UUID,   -- the single order created on finalize
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_orders_host_idx ON group_orders(host_id);

-- ─── group_order_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_order_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id       UUID NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
    contributor_id UUID NOT NULL REFERENCES auth.users(id),
    menu_item_id   UUID NOT NULL REFERENCES menu_items(id),
    name           TEXT NOT NULL,
    price_kobo     BIGINT NOT NULL CHECK (price_kobo >= 0),
    quantity       INT  NOT NULL CHECK (quantity >= 1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS group_order_items_group_idx ON group_order_items(group_id);

ALTER TABLE group_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_order_items ENABLE ROW LEVEL SECURITY;
-- Managed by the Go service (host/contributor checks); no direct client policy.
