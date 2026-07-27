-- Restaurant / Delivery — promo codes with per-promo funder (Phase 4, additive-only).
--
-- A promo applies a percentage or fixed discount to the item subtotal at order time.
-- Each promo declares who FUNDS the discount:
--   funder = 'restaurant' → the discount comes out of the restaurant's settlement leg;
--   funder = 'platform'   → the platform absorbs it (restaurant + rider settle on the
--                           full pre-discount gross).
-- The settlement engine (settlement.Split.DiscountKobo/DiscountFundedByPlatform) runs
-- the split accordingly; both funders conserve value exactly against the escrowed
-- (already-discounted) total. No DROP / RENAME / type narrowing.

-- ─── restaurant_promos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_promos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id     UUID REFERENCES restaurants(id) ON DELETE CASCADE, -- NULL = platform-wide
    code              TEXT NOT NULL CHECK (char_length(code) BETWEEN 2 AND 40),
    funder            TEXT NOT NULL CHECK (funder IN ('platform','restaurant')),
    kind              TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
    value_bp          INT    NOT NULL DEFAULT 0 CHECK (value_bp BETWEEN 0 AND 10000), -- basis points for percent
    amount_kobo       BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),             -- for fixed
    min_subtotal_kobo BIGINT NOT NULL DEFAULT 0 CHECK (min_subtotal_kobo >= 0),
    max_discount_kobo BIGINT CHECK (max_discount_kobo IS NULL OR max_discount_kobo >= 0), -- cap for percent
    starts_at         TIMESTAMPTZ,
    ends_at           TIMESTAMPTZ,
    usage_limit       INT CHECK (usage_limit IS NULL OR usage_limit >= 0),     -- total redemptions (NULL = unlimited)
    per_user_limit    INT CHECK (per_user_limit IS NULL OR per_user_limit >= 0),
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One code per scope (case-insensitive). Platform-wide promos (restaurant_id NULL)
-- collapse to a fixed sentinel so two of them can't share a code either.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_promos_code_uq
    ON restaurant_promos (COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));
CREATE INDEX IF NOT EXISTS restaurant_promos_restaurant_idx ON restaurant_promos (restaurant_id);

-- ─── restaurant_promo_redemptions ─────────────────────────────────────────────
-- One row per order that used a promo. UNIQUE(order_id) makes redemption idempotent
-- on order replay; the promo_id / (promo_id,user_id) indexes back the usage-limit
-- counts.
CREATE TABLE IF NOT EXISTS restaurant_promo_redemptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promo_id      UUID NOT NULL REFERENCES restaurant_promos(id) ON DELETE CASCADE,
    order_id      UUID NOT NULL,
    user_id       UUID NOT NULL,
    discount_kobo BIGINT NOT NULL CHECK (discount_kobo >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS restaurant_promo_redemptions_promo_idx ON restaurant_promo_redemptions (promo_id);
CREATE INDEX IF NOT EXISTS restaurant_promo_redemptions_promo_user_idx ON restaurant_promo_redemptions (promo_id, user_id);

-- ─── orders: promo snapshot columns ───────────────────────────────────────────
-- discount_kobo is the amount taken off the item subtotal; promo_funder snapshots who
-- bore it (drives the settlement split). Additive, NOT NULL DEFAULT 0 so every prior
-- order reads as "no discount" and past settlement math is unchanged.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_id      UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_funder  TEXT CHECK (promo_funder IS NULL OR promo_funder IN ('platform','restaurant'));

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE restaurant_promos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_promo_redemptions ENABLE ROW LEVEL SECURITY;
-- Promos are validated/redeemed by the Go service (owner check on writes, service-role
-- reads); no client policy is granted (redemptions hold no client-readable data).
