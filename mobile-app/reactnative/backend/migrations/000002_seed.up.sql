-- Demo seed so a fresh database runs out of the box (mirrors the in-memory mock).
-- In production, the asset catalogue is managed by the admin/asset service, not a
-- migration — this file is for local/demo only.

BEGIN;

INSERT INTO users (id, kyc_tier, crypto_enabled) VALUES
    ('demo-user', 2, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallet_balances (user_id, currency, available_minor) VALUES
    ('demo-user', 'NGN', 84250000)   -- ₦842,500.00
ON CONFLICT (user_id, currency) DO NOTHING;

-- Assets (prices in NGN minor units).
INSERT INTO assets
    (id, symbol, name, decimals, icon_color, risk_rating, status,
     buy_enabled, sell_enabled, deposit_enabled, withdrawal_enabled,
     min_order_amount, max_order_amount, price_amount, price_currency,
     change_24h_pct, market_cap_amount, volume_24h_amount,
     description, risk_disclosure, kyc_tier_required)
VALUES
    ('ast_btc','BTC','Bitcoin',8,'#F7931A','medium','active',
     TRUE,TRUE,TRUE,TRUE, 100000, 5000000000, 9842000000,'NGN',
     2.41, 194000000000000000, 4820000000000000,
     'Bitcoin is the first and largest cryptocurrency by market value.',
     'Bitcoin is volatile and its price can move sharply within a single day.', 2),
    ('ast_eth','ETH','Ethereum',8,'#627EEA','medium','active',
     TRUE,TRUE,TRUE,TRUE, 100000, 3000000000, 528000000,'NGN',
     -1.18, 64000000000000000, 2240000000000000,
     'Ethereum is a programmable blockchain powering smart contracts.',
     'Ethereum is volatile; upgrades and demand shifts cause sharp swings.', 2),
    ('ast_usdt','USDT','Tether USD',6,'#26A17B','low','active',
     TRUE,TRUE,TRUE,TRUE, 100000, 2000000000, 160500,'NGN',
     0.05, 18000000000000000, 7000000000000000,
     'Tether (USDT) is a stablecoin designed to track the US dollar 1:1.',
     'Stablecoins aim to hold a fixed value but can de-peg; not a bank deposit.', 1),
    ('ast_usdc','USDC','USD Coin',6,'#2775CA','low','active',
     TRUE,TRUE,TRUE,TRUE, 100000, 2000000000, 160400,'NGN',
     0.02, 5600000000000000, 1200000000000000,
     'USD Coin (USDC) is a fully-reserved stablecoin pegged to the US dollar.',
     'Stablecoins aim to hold a fixed value but can de-peg; not a bank deposit.', 1),
    ('ast_sol','SOL','Solana',8,'#9945FF','high','active',
     TRUE,TRUE,TRUE,TRUE, 100000, 1000000000, 23850000,'NGN',
     5.83, 11200000000000000, 940000000000000,
     'Solana is a high-throughput blockchain with fast, low-cost transactions.',
     'Solana is higher-risk with large price swings and congestion periods.', 2),
    ('ast_xrp','XRP','XRP',6,'#23292F','high','paused',
     FALSE,FALSE,FALSE,FALSE, 100000, 1000000000, 364000,'NGN',
     -0.74, 20500000000000000, 620000000000000,
     'XRP is the native asset of the XRP Ledger for cross-border transfer.',
     'XRP is higher-risk and is temporarily paused for trading on Paymax.', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO asset_networks (asset_id, network_id, name, confirmations) VALUES
    ('ast_btc','bitcoin','Bitcoin',2),
    ('ast_eth','ethereum','Ethereum (ERC-20)',12),
    ('ast_eth','base','Base',30),
    ('ast_usdt','tron','Tron (TRC-20)',20),
    ('ast_usdt','ethereum','Ethereum (ERC-20)',12),
    ('ast_usdc','ethereum','Ethereum (ERC-20)',12),
    ('ast_usdc','base','Base',30),
    ('ast_sol','solana','Solana',32),
    ('ast_xrp','xrpl','XRP Ledger',1)
ON CONFLICT (asset_id, network_id) DO NOTHING;

-- Demo holdings (qty in base units; cost basis in NGN minor units).
INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor) VALUES
    ('demo-user','ast_btc',  1820000,    167622000),
    ('demo-user','ast_eth',  94000000,   513240000),
    ('demo-user','ast_usdt', 1250000000, 199750000)
ON CONFLICT (user_id, asset_id) DO NOTHING;

-- Demo whitelisted withdrawal addresses.
INSERT INTO crypto_addresses (id, user_id, label, symbol, network_id, network_name, address, whitelisted, screened) VALUES
    ('addr_1','demo-user','My Ledger','BTC','bitcoin','Bitcoin','bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',TRUE,TRUE),
    ('addr_2','demo-user','Binance USDT','USDT','tron','Tron (TRC-20)','TJ8s3sB1kY7Yb9aQ2cZx4pN6mWvL1rGq5d',TRUE,TRUE)
ON CONFLICT (id) DO NOTHING;

-- Demo watchlist + alerts.
INSERT INTO watchlist_entries (user_id, asset_id) VALUES
    ('demo-user','ast_btc'), ('demo-user','ast_sol')
ON CONFLICT (user_id, asset_id) DO NOTHING;

INSERT INTO price_alerts (id, user_id, asset_id, symbol, icon_color, condition, target_amount_minor, currency, status) VALUES
    ('al_1','demo-user','ast_btc','BTC','#F7931A','above',10000000000,'NGN','active'),
    ('al_2','demo-user','ast_eth','ETH','#627EEA','below',500000000,'NGN','active')
ON CONFLICT (id) DO NOTHING;

COMMIT;
