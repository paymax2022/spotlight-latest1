-- ── FX Orchestration Layer ───────────────────────────────────────────────────
-- Additive-only migration for the Paymax FX orchestration module
-- (internal/orchestration). All monetary amounts are integers in minor units.
-- No DROP / no column renames / no type narrowing (iron rule: additive-only).

-- Multi-currency balance projection (one row per customer × currency).
CREATE TABLE IF NOT EXISTS orch_balances (
    customer_id   text   NOT NULL,
    currency      text   NOT NULL,
    balance_minor bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, currency)
);

-- Append-only multi-currency ledger entries (the FX source of truth, spec §8).
CREATE TABLE IF NOT EXISTS orch_ledger_entries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     text   NOT NULL,
    account         text   NOT NULL,                  -- customer_balance | paymax_spread | provider_clearing
    currency        text   NOT NULL,
    type            text   NOT NULL,                  -- DEBIT | CREDIT
    amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
    reference       text   NOT NULL,
    idempotency_key text   NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orch_ledger_idem_uniq ON orch_ledger_entries (idempotency_key);
CREATE INDEX IF NOT EXISTS orch_ledger_customer_idx ON orch_ledger_entries (customer_id, created_at DESC);

-- Quotes (audit of priced offers; the live lifecycle uses Redis/in-memory TTL).
CREATE TABLE IF NOT EXISTS orch_quotes (
    id            text PRIMARY KEY,
    customer_id   text NOT NULL,
    status        text NOT NULL,
    amount_type   text NOT NULL,
    source_currency text NOT NULL,
    source_minor    bigint NOT NULL,
    dest_currency   text NOT NULL,
    dest_minor      bigint NOT NULL,
    rate          double precision NOT NULL,
    all_in_rate   double precision NOT NULL,
    provider      text NOT NULL,
    corridor      text NOT NULL,
    rail          text NOT NULL,
    fees          jsonb NOT NULL DEFAULT '[]'::jsonb,
    locked        boolean NOT NULL DEFAULT false,
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Conversions (FX between two held balances).
CREATE TABLE IF NOT EXISTS orch_conversions (
    id              text PRIMARY KEY,
    reference       text NOT NULL,
    customer_id     text NOT NULL,
    status          text NOT NULL,
    source_currency text NOT NULL,
    source_minor    bigint NOT NULL,
    dest_currency   text NOT NULL,
    dest_minor      bigint NOT NULL,
    rate            double precision NOT NULL,
    all_in_rate     double precision NOT NULL,
    fees            jsonb NOT NULL DEFAULT '[]'::jsonb,
    provider        text NOT NULL,
    corridor        text NOT NULL,
    rail            text NOT NULL,
    provider_ref    text,
    transaction_id  text NOT NULL,
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orch_conversions_idem_uniq ON orch_conversions (idempotency_key);
CREATE INDEX IF NOT EXISTS orch_conversions_customer_idx ON orch_conversions (customer_id, created_at DESC);

-- Transfers (payouts, optionally with embedded FX).
CREATE TABLE IF NOT EXISTS orch_transfers (
    id              text PRIMARY KEY,
    reference       text NOT NULL,
    customer_id     text NOT NULL,
    status          text NOT NULL,
    source_currency text NOT NULL,
    source_minor    bigint NOT NULL,
    dest_currency   text NOT NULL,
    dest_minor      bigint NOT NULL,
    quoted_rate     double precision NOT NULL,
    executed_rate   double precision NOT NULL,
    fees            jsonb NOT NULL DEFAULT '[]'::jsonb,
    provider        text NOT NULL,
    corridor        text NOT NULL,
    rail            text NOT NULL,
    narration       text,
    provider_ref    text,
    transaction_id  text NOT NULL,
    status_history  jsonb NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orch_transfers_idem_uniq ON orch_transfers (idempotency_key);
CREATE INDEX IF NOT EXISTS orch_transfers_customer_idx ON orch_transfers (customer_id, created_at DESC);

-- Collections (inbound virtual accounts / IBANs).
CREATE TABLE IF NOT EXISTS orch_collections (
    id           text PRIMARY KEY,
    customer_id  text NOT NULL,
    currency     text NOT NULL,
    type         text NOT NULL,
    provider     text NOT NULL,
    status       text NOT NULL,
    details      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_collections_customer_idx ON orch_collections (customer_id, created_at DESC);
