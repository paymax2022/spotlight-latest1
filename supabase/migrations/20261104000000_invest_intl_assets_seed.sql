-- Invest catalog — international instruments seed (harvested from the standalone
-- crypto-backend `internal/stocks/mockdata.go` per ADR-025 parity diff).
--
-- The existing invest seed (20260621010000_invest_module.sql) already covers the
-- NGX names in that mock data (DANGCEM, MTNN, GTCO, ZENITHBANK, ARADEL, NESTLE).
-- The only NEW catalog coverage the mock data adds is international (US) tickers —
-- seeded here so the discovery/search/watchlist/chart surface has them ahead of a
-- real US-market broker.
--
-- Trading is intentionally DISABLED (buy_enabled/sell_enabled = false) and gated at
-- kyc_tier_required = 3: these are discovery-only until a US execution venue + FX
-- path is wired. Additive-only, idempotent (ON CONFLICT (symbol) DO NOTHING).

INSERT INTO public.invest_stock_assets
    (symbol, name, exchange, sector, board, asset_class, status, buy_enabled, sell_enabled,
     risk_rating, minimum_order_amount, kyc_tier_required, country_availability,
     provider_symbol, settlement_days, description)
VALUES
    ('AAPL','Apple Inc.','NASDAQ','Technology','Main','equity','active',false,false,
     'medium',1000000,3,'NG','AAPL',2,
     'Apple Inc. — US technology (NASDAQ). Discovery only until a US-market broker is wired.'),
    ('TSLA','Tesla, Inc.','NASDAQ','Automotive','Main','equity','active',false,false,
     'high',1000000,3,'NG','TSLA',2,
     'Tesla, Inc. — US automotive / EV (NASDAQ). Discovery only until a US-market broker is wired.'),
    ('VOO','Vanguard S&P 500 ETF','NYSE','ETF','ETF','etf','active',false,false,
     'low',1000000,3,'NG','VOO',2,
     'Vanguard S&P 500 ETF — tracks the S&P 500 (NYSE Arca). Discovery only until a US-market broker is wired.')
ON CONFLICT (symbol) DO NOTHING;
