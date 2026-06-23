-- Reverse of 000001_init.up.sql — drops in dependency order.
BEGIN;

DROP TABLE IF EXISTS crypto_addresses;
DROP TABLE IF EXISTS price_alerts;
DROP TABLE IF EXISTS watchlist_entries;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS quotes;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS crypto_transaction_status_events;
DROP TABLE IF EXISTS crypto_transaction_fees;
DROP TABLE IF EXISTS crypto_transactions;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS asset_networks;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS users;

COMMIT;
