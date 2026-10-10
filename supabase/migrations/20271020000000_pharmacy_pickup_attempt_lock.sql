-- Pharmacy fulfilment-code brute-force guard (security re-review R3).
--
-- pickup_code is a 6-digit credential the patient presents to complete
-- PICKUP/DELIVERY fulfilment. The verified pharmacy owner is a legitimate
-- completing party AND the escrow payee, so it has motive and — before this —
-- unlimited attempts to guess the patient's code and self-release the hold.
-- These columns back a per-order attempt counter: Complete refuses further
-- code checks once pickup_locked is set (>=5 failures), pending support or a
-- dispute. Additive only — existing rows default to unlocked with zero
-- attempts; no behaviour changes until the service writes to the columns.

ALTER TABLE public.pharmacy_orders
  ADD COLUMN IF NOT EXISTS pickup_attempts integer NOT NULL DEFAULT 0
    CHECK (pickup_attempts >= 0),
  ADD COLUMN IF NOT EXISTS pickup_locked boolean NOT NULL DEFAULT false;
