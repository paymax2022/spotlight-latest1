-- Revert to buy/sell only (fails if deposit/withdraw rows exist — clear them first).
BEGIN;
ALTER TABLE crypto_transactions DROP CONSTRAINT crypto_transactions_side_check;
ALTER TABLE crypto_transactions
    ADD CONSTRAINT crypto_transactions_side_check
    CHECK (side IN ('buy', 'sell'));
COMMIT;
