-- Paymax Invest · Crypto — initial schema (expand-only).
--
-- Conventions:
--   * All money is BIGINT in MINOR UNITS (kobo for fiat, base units for crypto) —
--     never floats. Currency/symbol is stored alongside.
--   * IDs are TEXT to match the service's prefixed ids (e.g. 'ast_btc', 'co_…').
--   * Timestamps are TIMESTAMPTZ (UTC).
--   * This is an EXPAND migration: it only adds objects. Destructive changes go in
--     later contract migrations, decoupled from the code that needs them.
--
-- Run with golang-migrate:  migrate -path migrations -database "$DATABASE_URL" up

BEGIN;

-- ── Users (minimal; real identity lives in the auth service) ──────────────────
CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    kyc_tier    INT  NOT NULL DEFAULT 0,
    crypto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Assets (admin-whitelisted catalogue) ──────────────────────────────────────
CREATE TABLE assets (
    id                  TEXT PRIMARY KEY,
    symbol              TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    decimals            INT  NOT NULL,
    icon_color          TEXT NOT NULL,
    risk_rating         TEXT NOT NULL CHECK (risk_rating IN ('low','medium','high')),
    status              TEXT NOT NULL CHECK (status IN ('active','paused','delisted')),
    buy_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    sell_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    deposit_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    withdrawal_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    min_order_amount    BIGINT NOT NULL DEFAULT 0,  -- minor units, settlement fiat
    max_order_amount    BIGINT NOT NULL DEFAULT 0,
    price_amount        BIGINT NOT NULL DEFAULT 0,  -- minor units per 1 coin
    price_currency      TEXT   NOT NULL DEFAULT 'NGN',
    change_24h_pct      DOUBLE PRECISION NOT NULL DEFAULT 0,
    market_cap_amount   BIGINT NOT NULL DEFAULT 0,
    volume_24h_amount   BIGINT NOT NULL DEFAULT 0,
    description         TEXT NOT NULL DEFAULT '',
    risk_disclosure     TEXT NOT NULL DEFAULT '',
    kyc_tier_required   INT  NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset_networks (
    asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    network_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    confirmations   INT  NOT NULL DEFAULT 1,
    PRIMARY KEY (asset_id, network_id)
);

-- ── Holdings (one row per user/asset) ─────────────────────────────────────────
CREATE TABLE positions (
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id          TEXT NOT NULL REFERENCES assets(id),
    qty_minor         BIGINT NOT NULL DEFAULT 0,  -- crypto base units
    cost_basis_minor  BIGINT NOT NULL DEFAULT 0,  -- settlement fiat minor units
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, asset_id)
);

-- ── Orders / transactions (buy · sell · swap) ─────────────────────────────────
CREATE TABLE crypto_transactions (
    id                  TEXT PRIMARY KEY,         -- transaction id (cx_…)
    user_id             TEXT NOT NULL REFERENCES users(id),
    reference           TEXT NOT NULL UNIQUE,     -- PMX-CR-… / PMX-SW-…
    side                TEXT NOT NULL CHECK (side IN ('buy','sell')),
    asset_id            TEXT NOT NULL REFERENCES assets(id),
    symbol              TEXT NOT NULL,
    asset_name          TEXT NOT NULL,
    icon_color          TEXT NOT NULL,
    status              TEXT NOT NULL,            -- crypto tx state machine
    fiat_amount         BIGINT NOT NULL,
    fiat_currency       TEXT NOT NULL DEFAULT 'NGN',
    crypto_amount       BIGINT NOT NULL,
    all_in_rate_amount  BIGINT NOT NULL DEFAULT 0,
    total_fiat_amount   BIGINT NOT NULL DEFAULT 0,
    provider            TEXT NOT NULL DEFAULT '',
    provider_reference  TEXT NOT NULL DEFAULT '',
    liquidity_provider  TEXT NOT NULL DEFAULT '',
    custody_provider    TEXT NOT NULL DEFAULT '',
    idempotency_key     TEXT,                     -- nullable; unique when present
    failure_reason      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_user_created ON crypto_transactions (user_id, created_at DESC);
CREATE INDEX idx_tx_side         ON crypto_transactions (side);
CREATE UNIQUE INDEX idx_tx_idem  ON crypto_transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE crypto_transaction_fees (
    transaction_id  TEXT NOT NULL REFERENCES crypto_transactions(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,               -- spread | paymax_fee | provider_fee | network_fee
    amount_minor    BIGINT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'NGN'
);
CREATE INDEX idx_tx_fees_tx ON crypto_transaction_fees (transaction_id);

CREATE TABLE crypto_transaction_status_events (
    transaction_id  TEXT NOT NULL REFERENCES crypto_transactions(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,
    at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_events_tx ON crypto_transaction_status_events (transaction_id);

-- ── Double-entry ledger (every balance movement writes one row) ───────────────
CREATE TABLE ledger_entries (
    id                  TEXT PRIMARY KEY,
    transaction_id      TEXT REFERENCES crypto_transactions(id),
    debit_account       TEXT NOT NULL,
    credit_account      TEXT NOT NULL,
    amount              BIGINT NOT NULL,         -- minor units
    currency            TEXT NOT NULL,
    type                TEXT NOT NULL,           -- buy | sell | swap | fee | reversal
    reference           TEXT NOT NULL DEFAULT '',
    provider_reference  TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ledger_tx ON ledger_entries (transaction_id);

-- ── Server quotes (execution runs against a stored quote_id) ──────────────────
CREATE TABLE quotes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id),
    kind        TEXT NOT NULL CHECK (kind IN ('trade','swap')),
    payload     JSONB NOT NULL,                  -- full quote snapshot
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_expiry ON quotes (expires_at);

-- ── Idempotency (replay returns the stored response) ──────────────────────────
CREATE TABLE idempotency_keys (
    key         TEXT PRIMARY KEY,
    user_id     TEXT,
    response    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Watchlist ─────────────────────────────────────────────────────────────────
CREATE TABLE watchlist_entries (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id    TEXT NOT NULL REFERENCES assets(id),
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, asset_id)
);

-- ── Price alerts ──────────────────────────────────────────────────────────────
CREATE TABLE price_alerts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id            TEXT NOT NULL REFERENCES assets(id),
    symbol              TEXT NOT NULL,
    icon_color          TEXT NOT NULL,
    condition           TEXT NOT NULL CHECK (condition IN ('above','below')),
    target_amount_minor BIGINT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'NGN',
    status              TEXT NOT NULL DEFAULT 'active',
    triggered_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_user ON price_alerts (user_id);

-- ── Withdrawal address book (whitelisted + screened) ──────────────────────────
CREATE TABLE crypto_addresses (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    network_id      TEXT NOT NULL,
    network_name    TEXT NOT NULL,
    address         TEXT NOT NULL,
    whitelisted     BOOLEAN NOT NULL DEFAULT FALSE,
    screened        BOOLEAN NOT NULL DEFAULT FALSE,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addr_user_symbol ON crypto_addresses (user_id, symbol);

COMMIT;
