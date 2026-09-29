-- Per-order takeaway packaging charge — additive-only.
--
-- WHY
-- 20261113000000 gave the RESTAURANT a packaging_fee_kobo (the price of one pack).
-- This records what a specific order was actually charged, so the amount is
-- auditable against the escrowed total forever — a later change to the store's
-- fee must not retroactively alter what a past customer paid.
--
-- Mirrors the existing per-order money columns (tip_kobo, discount_kobo,
-- service_fee_kobo, surge_kobo): BIGINT integer kobo, NOT NULL DEFAULT 0.
--
-- SAFETY: additive-only per CLAUDE.md. ADD COLUMN with a DEFAULT backfills every
-- existing order to 0, which is exactly right — no historical order was ever
-- charged packaging, so no past total changes and settlement conservation over
-- historical rows is untouched.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS packaging_kobo BIGINT NOT NULL DEFAULT 0;

-- Fail closed on nonsense values. A negative packaging charge would reduce the
-- order total below the sum of its parts and break the settlement remainder.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_packaging_kobo_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_packaging_kobo_nonneg CHECK (packaging_kobo >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.packaging_kobo IS
  'Takeaway packaging charged on THIS order, in integer kobo: the restaurant''s '
  'packaging_fee_kobo at order time x the number of packs. Snapshotted per order '
  'so a later change to the store fee cannot rewrite historical totals. Part of '
  'total_kobo, and settles to the restaurant via the provider remainder.';
