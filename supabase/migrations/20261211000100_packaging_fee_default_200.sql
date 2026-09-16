-- Set the takeaway packaging price to ₦200 per pack — additive-only.
--
-- WHY
-- 20261113000000 added `restaurants.packaging_fee_kobo` with DEFAULT 0 and said
-- so explicitly: "this migration alone changes no price. A restaurant only starts
-- charging packaging once an operator sets a non-zero value." No operator ever
-- did — all 697 restaurants sat at 0 — so checkout showed "Takeaway packaging
-- (3 packs) ₦0.00" and the packs were, in effect, free.
--
-- This sets the platform default to ₦200 (20,000 kobo) per pack and applies it to
-- the existing estate. The restaurant OWNER remains free to set their own price,
-- including back to 0; this is the starting point, not a fixed rate.
--
-- ⚠️ UNLIKE its predecessor, this migration DOES change live prices. Every
-- restaurant currently at 0 begins charging ₦200 per takeaway pack on the next
-- order placed after it runs. That is the intended, explicitly requested effect —
-- flagged here because a price change reached by backfill is easy to miss in a
-- diff, and because it is the line a reviewer should stop at.
--
-- Only rows still at 0 are moved, so an owner who has already priced their own
-- packaging is never overwritten — and re-running the migration is a no-op rather
-- than a second price change.
--
-- SAFETY
-- Additive-only per CLAUDE.md: no DROP, no rename, no type narrowing. The column,
-- its NOT NULL and its >= 0 check already exist and are untouched. Integer minor
-- units (kobo) per the money iron rules, never a float.

-- New restaurants start at the platform default.
ALTER TABLE public.restaurants
  ALTER COLUMN packaging_fee_kobo SET DEFAULT 20000;

-- Existing restaurants that never set a price adopt it. `= 0` (not `IS NULL` —
-- the column is NOT NULL) is what makes this idempotent and non-destructive.
UPDATE public.restaurants
   SET packaging_fee_kobo = 20000
 WHERE packaging_fee_kobo = 0;

COMMENT ON COLUMN public.restaurants.packaging_fee_kobo IS
  'Price of ONE takeaway pack, integer kobo. Platform default 20000 (₦200); owner-settable, 0 means the restaurant charges nothing for packaging.';
