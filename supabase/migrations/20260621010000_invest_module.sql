-- ── Paymax Invest (Stocks) Module ────────────────────────────────────────────
-- Additive-only migration for the stock-trading module (internal/invest).
-- Iron rules honoured:
--   * All monetary amounts are integers in MINOR units (kobo). Never floats.
--   * No DROP / no column renames / no type narrowing (additive-only).
--   * Investment wallet is a double-entry ledger, logically separate from the
--     main Paymax wallet (its own invest_ledger_accounts / invest_ledger_entries).
--   * Wallet/position balances are PROJECTIONS of the ledger / fills — never a
--     directly-mutated balance column treated as source of truth.
--   * Orders carry an idempotency key (unique) and a provider reference.
--
-- Everything is feature-flagged off in the app layer (FEATURE_INVEST_ENABLED).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Investor profile, accounts, suitability, agreements
-- ─────────────────────────────────────────────────────────────────────────────

-- One investor profile per Paymax user. Reuses existing auth (user_id = auth uid).
CREATE TABLE IF NOT EXISTS invest_profiles (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                text NOT NULL UNIQUE,
    kyc_tier               int  NOT NULL DEFAULT 0,        -- 0..3 (see compliance.md)
    suitability_profile_id uuid,
    risk_category          text NOT NULL DEFAULT 'restricted', -- conservative|balanced|growth|aggressive|restricted
    country                text NOT NULL DEFAULT 'NG',
    residency_country      text NOT NULL DEFAULT 'NG',
    investment_enabled     boolean NOT NULL DEFAULT false,
    stock_trading_enabled  boolean NOT NULL DEFAULT false,
    public_offer_enabled   boolean NOT NULL DEFAULT false,
    rights_issue_enabled   boolean NOT NULL DEFAULT false,
    status                 text NOT NULL DEFAULT 'not_started',
        -- not_started|started|kyc_required|kyc_pending|kyc_rejected|terms_required|
        -- suitability_required|approved|restricted|suspended
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_profiles_user_idx ON invest_profiles (user_id);

-- Broker-backed investment account (partner-led; reconciled vs broker records).
CREATE TABLE IF NOT EXISTS invest_accounts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              text NOT NULL,
    account_number       text NOT NULL UNIQUE,
    broker_provider_id   text,
    broker_account_id    text,
    cscs_number          text,
    clearing_house_number text,
    base_currency        text NOT NULL DEFAULT 'NGN',
    status               text NOT NULL DEFAULT 'active', -- pending|active|suspended|closed
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_accounts_user_idx ON invest_accounts (user_id);

-- Suitability questionnaire result (answers stored as jsonb; score → category).
CREATE TABLE IF NOT EXISTS invest_suitability_profiles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       text NOT NULL,
    answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
    score         int  NOT NULL DEFAULT 0,
    risk_category text NOT NULL DEFAULT 'restricted',
    version       text NOT NULL DEFAULT 'v1',
    status        text NOT NULL DEFAULT 'active', -- active|expired|forced_retake
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_suitability_user_idx ON invest_suitability_profiles (user_id, created_at DESC);

-- Versioned legal agreements the user must accept before access.
CREATE TABLE IF NOT EXISTS invest_agreements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text NOT NULL,   -- investment_terms|broker_terms|market_data_terms|risk_disclosure|no_advice|privacy|fees
    title       text NOT NULL,
    version     text NOT NULL,
    body_url    text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS invest_agreement_acceptances (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        text NOT NULL,
    agreement_key  text NOT NULL,
    version        text NOT NULL,
    accepted_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, agreement_key, version)
);
CREATE INDEX IF NOT EXISTS invest_agreement_acc_user_idx ON invest_agreement_acceptances (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tradable universe (admin-controlled; never hard-coded in client)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_stock_assets (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol               text NOT NULL UNIQUE,
    name                 text NOT NULL,
    exchange             text NOT NULL DEFAULT 'NGX',
    sector               text,
    board                text,
    isin                 text,
    asset_class          text NOT NULL DEFAULT 'equity', -- equity|etf
    status               text NOT NULL DEFAULT 'active',  -- active|suspended|delisted
    buy_enabled          boolean NOT NULL DEFAULT false,
    sell_enabled         boolean NOT NULL DEFAULT false,
    risk_rating          text NOT NULL DEFAULT 'medium',  -- low|medium|high
    minimum_order_amount bigint NOT NULL DEFAULT 0,       -- kobo
    maximum_order_amount bigint NOT NULL DEFAULT 0,       -- kobo; 0 = no cap
    kyc_tier_required    int  NOT NULL DEFAULT 2,
    country_availability text NOT NULL DEFAULT 'NG',
    provider_symbol      text,
    logo_url             text,
    description          text,
    settlement_days      int  NOT NULL DEFAULT 3,         -- T+N
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_stock_assets_status_idx ON invest_stock_assets (status);
CREATE INDEX IF NOT EXISTS invest_stock_assets_sector_idx ON invest_stock_assets (sector);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Investment wallet — DOUBLE-ENTRY ledger (separate from main Paymax wallet)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_ledger_accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text,   -- nil for standing/system accounts
    type       text NOT NULL,
        -- invest_cash | invest_locked_cash | invest_settlement_suspense |
        -- broker_clearing | invest_fee_income | invest_dividend_source |
        -- invest_external_funding
    currency   text NOT NULL DEFAULT 'NGN',
    created_at timestamptz NOT NULL DEFAULT now()
);
-- User accounts unique on (user_id, type, currency); standing accounts unique on (type, currency).
CREATE UNIQUE INDEX IF NOT EXISTS invest_ledger_user_acct_uniq
    ON invest_ledger_accounts (user_id, type, currency) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invest_ledger_standing_acct_uniq
    ON invest_ledger_accounts (type, currency) WHERE user_id IS NULL;

-- Append-only, immutable journal entries. Balance = projection (SUM) of these.
CREATE TABLE IF NOT EXISTS invest_ledger_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      uuid NOT NULL REFERENCES invest_ledger_accounts(id),
    type            text NOT NULL,    -- DEBIT | CREDIT | REVERSAL_DEBIT | REVERSAL_CREDIT
    amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
    currency        text NOT NULL DEFAULT 'NGN',
    txn_type        text NOT NULL,    -- deposit|withdrawal|stock_purchase|stock_sale|fee_debit|
                                      -- fee_refund|dividend_credit|public_offer|rights_issue|
                                      -- reversal|settlement_release|cash_lock|cash_unlock|manual_adjustment
    reference       text NOT NULL,
    provider_reference text,
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invest_ledger_idem_uniq ON invest_ledger_entries (idempotency_key);
CREATE INDEX IF NOT EXISTS invest_ledger_account_idx ON invest_ledger_entries (account_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Orders, positions, portfolio snapshots
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_orders (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             text NOT NULL,
    investment_account_id uuid REFERENCES invest_accounts(id),
    stock_asset_id      uuid NOT NULL REFERENCES invest_stock_assets(id),
    symbol              text NOT NULL,
    side                text NOT NULL,            -- buy | sell
    order_type          text NOT NULL DEFAULT 'market', -- market | limit
    amount_kobo         bigint NOT NULL DEFAULT 0, -- notional requested (buy by amount)
    quantity            numeric(20,4) NOT NULL DEFAULT 0,
    limit_price_kobo    bigint NOT NULL DEFAULT 0,
    estimated_price_kobo bigint NOT NULL DEFAULT 0,
    executed_price_kobo bigint NOT NULL DEFAULT 0,
    filled_quantity     numeric(20,4) NOT NULL DEFAULT 0,
    fees_kobo           bigint NOT NULL DEFAULT 0,
    total_amount_kobo   bigint NOT NULL DEFAULT 0, -- gross debit (buy) / net proceeds (sell)
    locked_cash_kobo    bigint NOT NULL DEFAULT 0,
    locked_quantity     numeric(20,4) NOT NULL DEFAULT 0,
    status              text NOT NULL DEFAULT 'Draft',
        -- Draft|PendingReview|AwaitingConfirmation|CashLocked|Submitted|Accepted|
        -- PartiallyFilled|Filled|PendingSettlement|Settled|CancelRequested|Cancelled|
        -- Rejected|Failed|ReversalPending|Reversed|ComplianceHold
    provider            text,
    provider_reference  text,
    idempotency_key     text NOT NULL,
    failure_reason      text,
    settlement_due_at   timestamptz,
    submitted_at        timestamptz,
    filled_at           timestamptz,
    settled_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invest_orders_idem_uniq ON invest_orders (idempotency_key);
CREATE INDEX IF NOT EXISTS invest_orders_user_idx ON invest_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invest_orders_status_idx ON invest_orders (status);

-- Immutable per-order event timeline (state-machine transitions + provider refs).
CREATE TABLE IF NOT EXISTS invest_order_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    uuid NOT NULL REFERENCES invest_orders(id),
    from_status text,
    to_status   text NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_order_events_order_idx ON invest_order_events (order_id, created_at);

-- Holdings. quantity = projection of settled fills; available = quantity - locked.
CREATE TABLE IF NOT EXISTS invest_positions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              text NOT NULL,
    stock_asset_id       uuid NOT NULL REFERENCES invest_stock_assets(id),
    symbol               text NOT NULL,
    quantity             numeric(20,4) NOT NULL DEFAULT 0,
    locked_quantity      numeric(20,4) NOT NULL DEFAULT 0,
    average_cost_kobo    bigint NOT NULL DEFAULT 0,
    realized_gain_kobo   bigint NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, stock_asset_id)
);
CREATE INDEX IF NOT EXISTS invest_positions_user_idx ON invest_positions (user_id);

CREATE TABLE IF NOT EXISTS invest_portfolio_snapshots (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            text NOT NULL,
    total_value_kobo   bigint NOT NULL DEFAULT 0,
    cash_balance_kobo  bigint NOT NULL DEFAULT 0,
    invested_value_kobo bigint NOT NULL DEFAULT 0,
    daily_gain_kobo    bigint NOT NULL DEFAULT 0,
    total_gain_kobo    bigint NOT NULL DEFAULT 0,
    pending_settlement_kobo bigint NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_portfolio_snap_user_idx ON invest_portfolio_snapshots (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Watchlists & price alerts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_watchlists (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    text NOT NULL,
    name       text NOT NULL DEFAULT 'My Watchlist',
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_watchlists_user_idx ON invest_watchlists (user_id);

CREATE TABLE IF NOT EXISTS invest_watchlist_items (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    watchlist_id   uuid NOT NULL REFERENCES invest_watchlists(id) ON DELETE CASCADE,
    stock_asset_id uuid NOT NULL REFERENCES invest_stock_assets(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (watchlist_id, stock_asset_id)
);

CREATE TABLE IF NOT EXISTS invest_price_alerts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        text NOT NULL,
    stock_asset_id uuid NOT NULL REFERENCES invest_stock_assets(id),
    symbol         text NOT NULL,
    condition      text NOT NULL,  -- above | below | pct_gain | pct_loss
    target_price_kobo bigint NOT NULL DEFAULT 0,
    status         text NOT NULL DEFAULT 'active', -- active|triggered|cancelled
    triggered_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_price_alerts_user_idx ON invest_price_alerts (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Dividends & corporate actions (read surfaces; provider/admin-sourced)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_dividends (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_asset_id      uuid NOT NULL REFERENCES invest_stock_assets(id),
    symbol              text NOT NULL,
    amount_per_share_kobo bigint NOT NULL DEFAULT 0,
    currency            text NOT NULL DEFAULT 'NGN',
    ex_date             date,
    record_date         date,
    payment_date        date,
    status              text NOT NULL DEFAULT 'announced', -- announced|paid|cancelled
    source              text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_dividends_asset_idx ON invest_dividends (stock_asset_id);

CREATE TABLE IF NOT EXISTS invest_corporate_actions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_asset_id uuid NOT NULL REFERENCES invest_stock_assets(id),
    symbol         text NOT NULL,
    type           text NOT NULL, -- dividend|bonus|split|reverse_split|merger|delisting|suspension|name_change|tender
    title          text NOT NULL,
    description    text,
    effective_date date,
    record_date    date,
    payment_date   date,
    status         text NOT NULL DEFAULT 'announced',
    source         text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_corp_actions_asset_idx ON invest_corporate_actions (stock_asset_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Public offers & rights issues
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_public_offers (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer_name          text NOT NULL,
    symbol               text,
    offer_price_kobo     bigint NOT NULL DEFAULT 0,
    minimum_subscription_kobo bigint NOT NULL DEFAULT 0,
    opening_date         date,
    closing_date         date,
    prospectus_url       text,
    status               text NOT NULL DEFAULT 'upcoming',
        -- upcoming|open|closing_soon|closed|processing|allotment_pending|allotted|
        -- partially_allotted|refund_pending|completed|cancelled
    provider_reference   text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invest_public_offer_applications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_offer_id uuid NOT NULL REFERENCES invest_public_offers(id),
    user_id         text NOT NULL,
    amount_kobo     bigint NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'submitted',
    idempotency_key text NOT NULL,
    allotted_kobo   bigint NOT NULL DEFAULT 0,
    refund_kobo     bigint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invest_po_app_idem_uniq ON invest_public_offer_applications (idempotency_key);
CREATE INDEX IF NOT EXISTS invest_po_app_user_idx ON invest_public_offer_applications (user_id);

CREATE TABLE IF NOT EXISTS invest_rights_issues (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer_name       text NOT NULL,
    symbol            text,
    ratio             text,
    offer_price_kobo  bigint NOT NULL DEFAULT 0,
    qualification_date date,
    opening_date      date,
    closing_date      date,
    status            text NOT NULL DEFAULT 'announced',
        -- announced|open|closing_soon|closed|processing|accepted|partially_accepted|lapsed|completed
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invest_rights_issue_applications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rights_issue_id uuid NOT NULL REFERENCES invest_rights_issues(id),
    user_id         text NOT NULL,
    accepted_units  numeric(20,4) NOT NULL DEFAULT 0,
    amount_kobo     bigint NOT NULL DEFAULT 0,
    status          text NOT NULL DEFAULT 'accepted',
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invest_ri_app_idem_uniq ON invest_rights_issue_applications (idempotency_key);
CREATE INDEX IF NOT EXISTS invest_ri_app_user_idx ON invest_rights_issue_applications (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Admin audit (every sensitive admin action; maker-checker friendly)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invest_admin_audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    text NOT NULL,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text,
    old_value   jsonb,
    new_value   jsonb,
    reason      text,
    ip_address  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invest_admin_audit_entity_idx ON invest_admin_audit_log (entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Seed: a small NGX sample universe (admin can edit; trading flags off-safe).
--    Prices are not stored here — the market-data adapter is the source of truth.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO invest_stock_assets
    (symbol, name, exchange, sector, board, asset_class, status, buy_enabled, sell_enabled,
     risk_rating, minimum_order_amount, kyc_tier_required, provider_symbol, settlement_days, description)
VALUES
    ('DANGCEM','Dangote Cement Plc','NGX','Industrial Goods','Main','equity','active',true,true,'medium',1000000,2,'DANGCEM',3,'Largest cement producer in sub-Saharan Africa.'),
    ('MTNN','MTN Nigeria Communications Plc','NGX','Telecommunications','Main','equity','active',true,true,'medium',1000000,2,'MTNN',3,'Leading telecommunications operator in Nigeria.'),
    ('GTCO','Guaranty Trust Holding Co Plc','NGX','Financial Services','Main','equity','active',true,true,'medium',500000,2,'GTCO',3,'Tier-1 Nigerian banking and financial services group.'),
    ('ZENITHBANK','Zenith Bank Plc','NGX','Financial Services','Main','equity','active',true,true,'medium',500000,2,'ZENITHBANK',3,'One of Nigeria''s largest commercial banks.'),
    ('AIRTELAFRI','Airtel Africa Plc','NGX','Telecommunications','Main','equity','active',true,true,'medium',1000000,2,'AIRTELAFRI',3,'Pan-African telecoms and mobile-money provider.'),
    ('BUACEMENT','BUA Cement Plc','NGX','Industrial Goods','Main','equity','active',true,true,'medium',1000000,2,'BUACEMENT',3,'Major Nigerian cement manufacturer.'),
    ('NESTLE','Nestle Nigeria Plc','NGX','Consumer Goods','Main','equity','active',true,true,'low',1000000,2,'NESTLE',3,'Food and beverage consumer-goods company.'),
    ('SEPLAT','Seplat Energy Plc','NGX','Oil & Gas','Main','equity','active',true,true,'high',1000000,2,'SEPLAT',3,'Independent oil and gas exploration and production.'),
    ('ARADEL','Aradel Holdings Plc','NGX','Oil & Gas','Main','equity','active',false,false,'high',1000000,2,'ARADEL',3,'Energy company (trading disabled by default).'),
    ('VETIVA-GREEN','Vetiva Griffin 30 ETF','NGX','ETF','ETF','etf','active',true,true,'low',500000,2,'VG30',3,'ETF tracking the 30 most-capitalised NGX stocks.')
ON CONFLICT (symbol) DO NOTHING;

-- Seed active agreements (v1) so onboarding can gate on acceptance.
INSERT INTO invest_agreements (key, title, version, is_active) VALUES
    ('investment_terms','Investment Terms of Service','v1',true),
    ('broker_terms','Partner Broker Terms','v1',true),
    ('market_data_terms','Market Data Terms','v1',true),
    ('risk_disclosure','Risk Disclosure Statement','v1',true),
    ('no_advice','No Investment Advice Disclosure','v1',true),
    ('privacy','Privacy & Data Consent','v1',true),
    ('fees','Fees Schedule','v1',true)
ON CONFLICT (key, version) DO NOTHING;
