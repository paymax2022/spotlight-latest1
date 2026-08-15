-- Food cart persistence (P0).
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── food_carts ───────────────────────────────────────────────────────────
-- Stores customer cart state server-side for cross-device persistence.
CREATE TABLE IF NOT EXISTS food_carts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id TEXT,
    restaurant_name TEXT,
    packages      JSONB NOT NULL DEFAULT '[]',
    active_package_id TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id) -- one active cart per customer
);

CREATE INDEX IF NOT EXISTS food_carts_customer_idx ON food_carts(customer_id);
CREATE INDEX IF NOT EXISTS food_carts_updated_idx ON food_carts(updated_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE food_carts ENABLE ROW LEVEL SECURITY;

-- Customers can only see/edit their own cart.
CREATE POLICY "food_carts_select" ON food_carts FOR SELECT TO authenticated
    USING (customer_id = auth.uid());

CREATE POLICY "food_carts_insert" ON food_carts FOR INSERT TO authenticated
    WITH CHECK (customer_id = auth.uid());

CREATE POLICY "food_carts_update" ON food_carts FOR UPDATE TO authenticated
    USING (customer_id = auth.uid())
    WITH CHECK (customer_id = auth.uid());

CREATE POLICY "food_carts_delete" ON food_carts FOR DELETE TO authenticated
    USING (customer_id = auth.uid());

-- Service role can read/write all carts.
CREATE POLICY "food_carts_service" ON food_carts TO service_role USING (TRUE) WITH CHECK (TRUE);
