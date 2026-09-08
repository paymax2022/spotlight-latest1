-- Record the takeaway packaging charged on each order — additive-only.
--
-- WHY
-- 20261113000000 gave the per-pack PRICE a server-authoritative home on
-- `restaurants.packaging_fee_kobo`, but nothing ever charged it: PlaceOrder had
-- no packaging term, so the fee existed as configuration the order pipeline
-- never read. Checkout meanwhile has always shown a "Takeaway packaging" line
-- and added it to the total it displays — so the customer was shown one number
-- and billed another, on a money path.
--
-- PlaceOrder now prices packaging into the escrowed total. These columns record
-- what was actually charged, per order:
--
--   packaging_fee_kobo — the money (package_count × the restaurant's per-pack
--                        price, snapshotted at order time so a later price change
--                        never reprices a placed order)
--   package_count      — how many takeaway packs, for the receipt and for support
--                        answering "why am I paying ₦600 for packaging?"
--
-- The fee settles 100% to the RESTAURANT via settlement.Split.ProviderFeeKobo:
-- the restaurant buys the packs, so it is a pass-through cost and neither the
-- platform nor the rider takes a cut. Recording it on the order is what lets
-- settleOrder reconstruct that leg at release.
--
-- SAFETY
-- Additive-only per CLAUDE.md: ADD COLUMN with defaults, no DROP, no rename, no
-- type narrowing. DEFAULT 0 means every order already in the table reads back
-- exactly as it settled — this migration alone moves no money and reprices
-- nothing. Integer minor units (kobo) per the money iron rules, never a float.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS packaging_fee_kobo BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS package_count INTEGER NOT NULL DEFAULT 0;

-- Fail closed on nonsense values. A negative packaging fee would subtract from
-- the escrowed total and break settlement conservation; a negative pack count
-- could only come from a corrupt write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_packaging_fee_kobo_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_packaging_fee_kobo_nonneg
      CHECK (packaging_fee_kobo >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_package_count_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_package_count_nonneg
      CHECK (package_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.packaging_fee_kobo IS
  'Takeaway packaging charged on this order, integer kobo. Snapshotted at placement; settles 100% to the restaurant (settlement.Split.ProviderFeeKobo).';
COMMENT ON COLUMN public.orders.package_count IS
  'Number of takeaway packs this order was charged for. Clamped server-side to [1, total portions] at placement.';
