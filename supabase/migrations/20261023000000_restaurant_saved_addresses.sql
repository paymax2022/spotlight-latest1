-- Restaurant / Delivery — customer saved delivery addresses (Phase 13, additive-only).
-- GEO-001/005/006: multiple saved addresses per customer, one default. Discovery dish
-- search (DS-002) and dietary filter (DS-003) need no schema (they query menu_items).
-- No DROP / RENAME / type narrowing.

CREATE TABLE IF NOT EXISTS customer_addresses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label       TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),  -- "Home", "Office"
    address     TEXT NOT NULL CHECK (char_length(address) BETWEEN 3 AND 300),
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_addresses_user_idx ON customer_addresses(user_id);
-- At most one default address per user.
CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default
    ON customer_addresses(user_id) WHERE is_default;

ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_addresses_owner" ON customer_addresses FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
