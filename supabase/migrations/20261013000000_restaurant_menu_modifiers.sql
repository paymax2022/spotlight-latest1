-- Restaurant / Delivery — grouped menu-item modifiers (Phase 3, additive-only).
--
-- Adds priced, grouped modifiers to menu items (e.g. a required "Size" group where
-- you pick exactly one, an optional "Extras" group where you pick up to N). Each
-- chosen option adds a per-unit price delta on top of the item's base price. Chosen
-- options are snapshotted onto the order line so the price is reproducible even if
-- the menu later changes.
--
-- No settlement change: modifiers simply raise the item subtotal, which flows through
-- the existing 80/10/10 escrow split. No DROP / RENAME / type narrowing.

-- ─── menu_modifier_groups ─────────────────────────────────────────────────────
-- A named set of options attached to one menu item, with selection rules.
CREATE TABLE IF NOT EXISTS menu_modifier_groups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    required     BOOLEAN NOT NULL DEFAULT FALSE,
    min_select   INT NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select   INT NOT NULL DEFAULT 1 CHECK (max_select >= 1),
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- max must be able to satisfy min, and a required group must demand >= 1.
    CONSTRAINT menu_modifier_groups_minmax CHECK (max_select >= min_select),
    CONSTRAINT menu_modifier_groups_required_min CHECK (NOT required OR min_select >= 1)
);
CREATE INDEX IF NOT EXISTS menu_modifier_groups_item_idx ON menu_modifier_groups(menu_item_id);

-- ─── menu_modifiers ───────────────────────────────────────────────────────────
-- One selectable option within a group. price_delta_kobo is a non-negative per-unit
-- surcharge (add-ons never discount the base price).
CREATE TABLE IF NOT EXISTS menu_modifiers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id         UUID NOT NULL REFERENCES menu_modifier_groups(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    price_delta_kobo BIGINT NOT NULL DEFAULT 0 CHECK (price_delta_kobo >= 0),
    is_available     BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order       INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS menu_modifiers_group_idx ON menu_modifiers(group_id);

-- ─── order_item_modifiers ─────────────────────────────────────────────────────
-- Immutable snapshot of the modifiers chosen on an order line: the name + delta at
-- order time, so the historical price is never rewritten by later menu edits.
CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id    UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    modifier_id      UUID NOT NULL REFERENCES menu_modifiers(id),
    name             TEXT NOT NULL,
    price_delta_kobo BIGINT NOT NULL CHECK (price_delta_kobo >= 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_item_modifiers_line_idx ON order_item_modifiers(order_item_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE menu_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_modifiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;

-- Menu modifiers are public catalog data (readable by any authenticated user); the
-- Go service performs all writes with an owner check, so no write policy is granted.
CREATE POLICY "menu_modifier_groups_select" ON menu_modifier_groups FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "menu_modifiers_select"       ON menu_modifiers       FOR SELECT TO authenticated USING (TRUE);
