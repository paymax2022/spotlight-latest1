-- Block 29 UAT fix: estate_payments.reference was VARCHAR(80), but PayDues
-- (backend/internal/estate/service_dues.go) always builds
-- ref = "estate_dues:" + estateID + ":" + invoiceID, i.e. 12 + 36 + 1 + 36 = 85
-- chars with real UUID estate/invoice ids -- guaranteed to overflow on every
-- real payment ("value too long for type character varying(80)"). Live-DB UAT
-- (ESTATE-INT-001) caught this: the money path had never been exercised
-- against the real schema before. vendor_jobs.payout_ref (the equivalent field
-- for the sibling RequestPayout money path) is already TEXT/unbounded, so this
-- widens estate_payments.reference to match that precedent rather than picking
-- a new arbitrary cap.
--
-- ADDITIVE ONLY: widening a VARCHAR(80) to TEXT is a widening, not a
-- narrowing -- every existing value still fits, no DROP, no rename.
ALTER TABLE estate_payments
    ALTER COLUMN reference TYPE TEXT;
