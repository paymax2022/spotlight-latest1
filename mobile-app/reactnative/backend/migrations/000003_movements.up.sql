-- Allow on-chain movements (deposit/withdraw) as transaction sides, so they are
-- first-class in history alongside buy/sell.
BEGIN;
ALTER TABLE crypto_transactions DROP CONSTRAINT crypto_transactions_side_check;
ALTER TABLE crypto_transactions
    ADD CONSTRAINT crypto_transactions_side_check
    CHECK (side IN ('buy', 'sell', 'deposit', 'withdraw'));
COMMIT;
