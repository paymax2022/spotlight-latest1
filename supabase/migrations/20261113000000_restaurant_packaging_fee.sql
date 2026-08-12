-- Restaurant packaging fee (takeaway packs) — additive-only.
--
-- WHY
-- The mobile food cart is built on a "takeaway package" model: the customer adds
-- a pack, then puts food into it, and pays a mandatory fee per pack so the
-- restaurant can package the order (src/features/food/types.ts CartPackage).
-- app/food/checkout.tsx has always added `restaurant.packagingFeeKobo` to the
-- total it SHOWS the customer — but no such column, Go field, or pricing term
-- ever existed server-side. The value came only from src/features/food/mock.ts.
--
-- Live, that means the customer is shown a total the server never agrees with,
-- on a money path. This migration gives the fee a real, server-authoritative
-- home so the displayed total and the charged total are the same number.
--
-- SAFETY
-- Additive-only per CLAUDE.md: ADD COLUMN with a DEFAULT, no DROP, no rename, no
-- type narrowing. DEFAULT 0 means every existing restaurant keeps charging
-- exactly what it charges today — this migration alone changes no price. A
-- restaurant only starts charging packaging once an operator sets a non-zero
-- value.
--
-- Integer minor units (kobo) per the money iron rules — never a float.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS packaging_fee_kobo BIGINT NOT NULL DEFAULT 0;

-- Fail closed on nonsense values. A negative packaging fee would invert the
-- order total and break settlement conservation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'restaurants_packaging_fee_kobo_check'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_packaging_fee_kobo_check
      CHECK (packaging_fee_kobo >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.packaging_fee_kobo IS
  'Price of ONE mandatory takeaway pack, in integer kobo. Charged per pack on '
  'every order so the restaurant can package it. 0 = this store does not charge '
  'for packaging. Server-authoritative: the client displays this value but never '
  'computes it.';
