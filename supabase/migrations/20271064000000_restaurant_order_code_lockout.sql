-- FOOD-UAT-E-008: attempt tracking + lockout for the rider pickup / delivery codes.
-- ADDITIVE ONLY. 5 wrong attempts lock that code for 15 minutes; success resets.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_locked_until TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_locked_until TIMESTAMPTZ;
