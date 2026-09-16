-- ADDITIVE ONLY: restaurant order pickup code.
--
-- Mirrors the existing delivery_code (customer<->rider handoff, added in
-- 20260708000000_restaurant_autodispatch.sql): pickup_code is generated when
-- the restaurant marks an order `ready` and is entered by the rider in
-- ConfirmPickup to prove they collected the food from THIS restaurant. The
-- two codes are distinct handoffs (restaurant->rider vs rider->customer).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
