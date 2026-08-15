-- Restaurant / Delivery — rider tips (Phase 2, additive-only).
--
-- Adds an optional customer tip to an order. The tip is escrowed with the order
-- total at placement and paid 100% to the assigned rider at settlement (on TOP of
-- the 80/10/10 base split — the base percentages apply to total − tip, so the tip
-- never inflates the platform or restaurant cut). See settlement.Split.TipKobo.
--
-- Additive & backfill-safe: NOT NULL DEFAULT 0 means every existing order reads as
-- "no tip" and all prior settlement math is unchanged (tip == 0 ⇒ pure % split).

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tip_kobo BIGINT NOT NULL DEFAULT 0;

-- Money invariant: a tip is a non-negative whole-kobo amount. Named CHECK so it is
-- idempotent to (re-)apply. Guard against a duplicate-add on replay.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_tip_kobo_nonneg'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_tip_kobo_nonneg CHECK (tip_kobo >= 0);
    END IF;
END $$;
