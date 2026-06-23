-- ── Paymax Invest — Admin control plane ──────────────────────────────────────
-- Additive-only. Adds admin-configurable fee + limit config so fees/limits are
-- never hard-coded (iron rule 13). Single active row per key; changes are
-- audited via invest_admin_audit_log.

CREATE TABLE IF NOT EXISTS invest_fee_config (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commission_bps  int    NOT NULL DEFAULT 150,     -- 150 = 1.50%
    min_fee_kobo    bigint NOT NULL DEFAULT 10000,   -- ₦100 floor per trade
    is_active       boolean NOT NULL DEFAULT true,
    updated_by      text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active config row (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS invest_fee_config_active_uniq
    ON invest_fee_config (is_active) WHERE is_active = true;

-- Admin-configurable per-account trading limits (kobo). Optional; defaults 0 = off.
CREATE TABLE IF NOT EXISTS invest_limit_config (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    single_order_max_kobo   bigint NOT NULL DEFAULT 0,   -- 0 = no cap
    daily_order_max_kobo    bigint NOT NULL DEFAULT 0,
    daily_order_count_max   int    NOT NULL DEFAULT 0,
    is_active               boolean NOT NULL DEFAULT true,
    updated_by              text,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invest_limit_config_active_uniq
    ON invest_limit_config (is_active) WHERE is_active = true;

-- Seed defaults (matches DefaultFeeSchedule in code).
INSERT INTO invest_fee_config (commission_bps, min_fee_kobo, is_active)
SELECT 150, 10000, true
WHERE NOT EXISTS (SELECT 1 FROM invest_fee_config WHERE is_active = true);

INSERT INTO invest_limit_config (single_order_max_kobo, daily_order_max_kobo, daily_order_count_max, is_active)
SELECT 0, 0, 0, true
WHERE NOT EXISTS (SELECT 1 FROM invest_limit_config WHERE is_active = true);
