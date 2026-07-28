-- ── FX Beneficiaries + Rate Alerts ───────────────────────────────────────────
-- Additive-only migration for the two FX secondary features that graduate from
-- stubs to real persistence (internal/orchestration secondary store). Both tables
-- are customer-scoped; authZ is enforced in Go by filtering on customer_id (the
-- backend uses the service-role pgx pool, same pattern as the orch_* tables).
-- No DROP / no column renames / no type narrowing (iron rule: additive-only).

-- Saved payout beneficiaries (spec §5.6, §11). Not money-path: metadata only.
CREATE TABLE IF NOT EXISTS orch_beneficiaries (
    id             text PRIMARY KEY,
    customer_id    text NOT NULL,
    name           text NOT NULL,
    rail           text NOT NULL,               -- bank_transfer | mobile_money | iban | wallet | stablecoin
    scheme         text NOT NULL,               -- BANK | MOBILEMONEY | IBAN | WALLET | STABLECOIN
    currency       text NOT NULL,
    account_number text NOT NULL,               -- account / IBAN / phone / wallet address
    bank_name      text,                        -- or MoMo operator / network label (nullable)
    country_code   text NOT NULL,               -- ISO-3166 alpha-2
    validated      boolean NOT NULL DEFAULT false,
    favorite       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_beneficiaries_customer_idx
    ON orch_beneficiaries (customer_id, favorite DESC, created_at DESC);

-- Rate alerts (spec C). Not money-path: a watch on an indicative pair rate.
CREATE TABLE IF NOT EXISTS orch_rate_alerts (
    id            text PRIMARY KEY,
    customer_id   text NOT NULL,
    pair          text NOT NULL,                -- 'USD-NGN'
    from_currency text NOT NULL,
    to_currency   text NOT NULL,
    direction     text NOT NULL,                -- above | below
    target        double precision NOT NULL,    -- indicative (display) rate, not minor units
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    triggered_at  timestamptz
);
CREATE INDEX IF NOT EXISTS orch_rate_alerts_customer_idx
    ON orch_rate_alerts (customer_id, created_at DESC);
