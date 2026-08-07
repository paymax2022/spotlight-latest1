-- ── FX Virtual Cards + Collections read-backing ──────────────────────────────
-- Additive-only migration graduating the FX virtual-cards vertical
-- (internal/orchestration handler_cards.go) from honest stubs to real
-- persistence, and adding the read path for collections / virtual accounts.
--
-- Tenant model (same as the rest of the orch_fx_* console): there is no separate
-- `businesses` table — the FX account owner (authenticated customer / user_id) IS
-- the business/tenant. Card rows are scoped by `business_id` = the owner's
-- customer id, matching the orch_fx_* naming convention. The funding wallet lives
-- in orch_balances, which keys on `customer_id`; because business_id == customer
-- id for FX, the Go store passes the same value to both.
--
-- IRON RULES honoured: kobo int64 (all *_minor columns bigint); additive-only (no
-- DROP, no rename, no type narrowing). Card FUNDING is money-path: it debits
-- orch_balances and credits the card balance inside a single transaction, and is
-- deduped by a unique (business_id, idempotency_key) index on orch_fx_card_txns.
--
-- Collections / virtual accounts are NOT given a new table here: they already
-- persist to orch_collections (see 20260621000000_fx_orchestration.sql,
-- repository.go SaveCollection). The list endpoints read that existing table; this
-- migration only adds the card tables.

-- ─── Virtual cards ────────────────────────────────────────────────────────────
-- One row per issued card under a business. balance_minor is the card funding
-- balance (kobo); controls holds the SpendingControls JSON. No real issuer is
-- wired yet, so PAN/CVV are synthesized deterministically in Go (never stored).
CREATE TABLE IF NOT EXISTS orch_fx_cards (
    id                     text PRIMARY KEY,
    business_id            text   NOT NULL,                 -- owning account (customer/user id)
    label                  text,
    brand                  text,
    currency               text,
    last4                  text,
    exp_month              int,
    exp_year               int,
    cardholder_name        text,
    balance_minor          bigint NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
    status                 text   NOT NULL DEFAULT 'active',
    color                  text,
    spent_this_month_minor bigint NOT NULL DEFAULT 0,
    controls               jsonb  NOT NULL DEFAULT '{}'::jsonb,
    provider               text   DEFAULT 'maplerad',
    provider_card_id       text,                              -- issuer card id (Maplerad), NULL until issued
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orch_fx_cards_business_idx
    ON orch_fx_cards (business_id, created_at DESC);

-- ─── Card transactions (funding, refunds, and future spend) ───────────────────
-- Append-only per-card transaction record. Funding rows carry the request
-- idempotency_key; the unique partial index on (business_id, idempotency_key)
-- makes card funding idempotent (a retried Idempotency-Key cannot double-fund).
CREATE TABLE IF NOT EXISTS orch_fx_card_txns (
    id              text PRIMARY KEY,
    card_id         text   NOT NULL,
    business_id     text   NOT NULL,
    merchant        text,
    category        text,
    icon            text,
    amount_minor    bigint NOT NULL,
    currency        text,
    status          text   NOT NULL DEFAULT 'approved',
    decline_reason  text,
    idempotency_key text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orch_fx_card_txns_idem_uniq
    ON orch_fx_card_txns (business_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orch_fx_card_txns_card_idx
    ON orch_fx_card_txns (card_id, created_at DESC);
