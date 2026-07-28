-- Remove demo seed data.
BEGIN;
DELETE FROM price_alerts WHERE user_id = 'demo-user';
DELETE FROM watchlist_entries WHERE user_id = 'demo-user';
DELETE FROM crypto_addresses WHERE user_id = 'demo-user';
DELETE FROM positions WHERE user_id = 'demo-user';
DELETE FROM asset_networks WHERE asset_id IN ('ast_btc','ast_eth','ast_usdt','ast_usdc','ast_sol','ast_xrp');
DELETE FROM assets WHERE id IN ('ast_btc','ast_eth','ast_usdt','ast_usdc','ast_sol','ast_xrp');
DELETE FROM wallet_balances WHERE user_id = 'demo-user';
DELETE FROM users WHERE id = 'demo-user';
COMMIT;
