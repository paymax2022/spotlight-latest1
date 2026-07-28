-- ── Fractional Real Estate / Land Crowd-Investing Module ─────────────────────
-- Additive-only migration for internal/fractionalre.
-- Iron rules honoured:
--   * All monetary amounts are integers in MINOR units (kobo). Never floats.
--   * No DROP / no column renames / no type narrowing (additive-only).
--   * Money paths reuse the shared double-entry ledger (ledger_accounts /
--     ledger_entries) and settlement (settlements) primitives — these tables
--     hold only domain state, never a directly-mutated balance treated as truth.
--   * Cap-table units / raised_kobo are PROJECTIONS reconciled from
--     subscriptions and the ledger — never a source-of-truth balance.
--   * Every money mutation carries an idempotency key (unique) elsewhere; the
--     domain rows here reference the originating settlement / ledger event.
--   * Maker-checker (SoD) is enforced in code; the columns below capture who
--     proposed vs. who approved a round close / refund / distribution.
--
-- Everything is feature-flagged off in the app layer (FEATURE_FRACTIONAL_RE_ENABLED).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sponsors, assets/properties
-- ─────────────────────────────────────────────────────────────────────────────

-- A sponsor/portfolio owner whose vetted assets are offered on the platform.
CREATE TABLE IF NOT EXISTS fre_sponsors (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    legal_name   text,
    trustee_name text,                              -- registered trustee (custodian)
    description  text,
    status       text NOT NULL DEFAULT 'active',    -- active|suspended
    created_by   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_sponsors_status_idx ON fre_sponsors (status);

-- A named, identified asset (no blind pools — every raise maps to one asset).
CREATE TABLE IF NOT EXISTS fre_assets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsor_id      uuid REFERENCES fre_sponsors(id),
    name            text NOT NULL,
    asset_type      text NOT NULL,                  -- income_property|development_debt|land
    description     text,
    location        text,
    geo_lat         double precision,
    geo_lng         double precision,
    -- Lifecycle state machine (role-gated transitions enforced in code):
    -- draft|due_diligence|title_verify|approved|live|funded|refund_close|
    -- under_management|distributions|exit|closed
    status          text NOT NULL DEFAULT 'draft',
    title_status    text NOT NULL DEFAULT 'unverified', -- unverified|verifying|verified|rejected
    title_verified_by text,                         -- MUST differ from created_by (SoD)
    title_verified_at timestamptz,
    nav_kobo        bigint NOT NULL DEFAULT 0 CHECK (nav_kobo >= 0), -- net asset value anchor (secondary market)
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_assets_status_idx ON fre_assets (status);
CREATE INDEX IF NOT EXISTS fre_assets_sponsor_idx ON fre_assets (sponsor_id);
CREATE INDEX IF NOT EXISTS fre_assets_type_idx ON fre_assets (asset_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Offerings / funding rounds
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_offerings (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id           uuid NOT NULL REFERENCES fre_assets(id),
    name               text NOT NULL,
    unit_price_kobo    bigint NOT NULL CHECK (unit_price_kobo > 0),
    share_count        bigint NOT NULL CHECK (share_count > 0),     -- total units issued
    target_kobo        bigint NOT NULL CHECK (target_kobo > 0),     -- = unit_price * share_count
    min_threshold_kobo bigint NOT NULL CHECK (min_threshold_kobo >= 0), -- release gate
    ticket_min_kobo    bigint NOT NULL DEFAULT 0 CHECK (ticket_min_kobo >= 0),
    ticket_max_kobo    bigint NOT NULL DEFAULT 0 CHECK (ticket_max_kobo >= 0), -- 0 = no cap
    -- status: draft|open|closing|funded|refunding|refunded|closed
    status             text NOT NULL DEFAULT 'draft',
    opens_at           timestamptz,
    closes_at          timestamptz,                  -- <= opens_at + 60d (+30d via extension)
    extension_days     int NOT NULL DEFAULT 0 CHECK (extension_days >= 0 AND extension_days <= 30),
    raised_kobo        bigint NOT NULL DEFAULT 0 CHECK (raised_kobo >= 0), -- projection
    units_sold         bigint NOT NULL DEFAULT 0 CHECK (units_sold >= 0),  -- projection
    investor_count     int NOT NULL DEFAULT 0 CHECK (investor_count >= 0), -- projection
    escrow_reference   text,                         -- settlement reference binding this round's escrow
    -- Maker-checker on close/refund (different users; enforced in code):
    close_proposed_by  text,
    close_approved_by  text,
    closed_at          timestamptz,
    created_by         text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_offerings_asset_idx ON fre_offerings (asset_id);
CREATE INDEX IF NOT EXISTS fre_offerings_status_idx ON fre_offerings (status);
CREATE INDEX IF NOT EXISTS fre_offerings_closes_idx ON fre_offerings (closes_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Subscriptions (escrowed commitments into a round)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id     uuid NOT NULL REFERENCES fre_offerings(id),
    user_id         text NOT NULL,
    units           bigint NOT NULL CHECK (units > 0),
    amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
    -- status: escrowed|allocated|refunded
    status          text NOT NULL DEFAULT 'escrowed',
    settlement_id   text,                            -- escrow settlement row
    idempotency_key text NOT NULL UNIQUE,            -- one subscription per key (idempotent double-subscribe)
    risk_ack_id     uuid,                            -- per-offer risk acknowledgement
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_subscriptions_offering_idx ON fre_subscriptions (offering_id);
CREATE INDEX IF NOT EXISTS fre_subscriptions_user_idx ON fre_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS fre_subscriptions_status_idx ON fre_subscriptions (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cap table (issued beneficial units per investor per asset)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_cap_table (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id     uuid NOT NULL REFERENCES fre_assets(id),
    offering_id  uuid REFERENCES fre_offerings(id),
    user_id      text NOT NULL,
    units        bigint NOT NULL CHECK (units >= 0),
    cost_kobo    bigint NOT NULL DEFAULT 0 CHECK (cost_kobo >= 0),
    pct_bps      int NOT NULL DEFAULT 0 CHECK (pct_bps >= 0), -- ownership in basis points (projection)
    source       text NOT NULL DEFAULT 'primary',  -- primary|secondary
    cert_ref     text,                              -- R2 object key for the certificate
    acquired_at  timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_cap_table_asset_idx ON fre_cap_table (asset_id);
CREATE INDEX IF NOT EXISTS fre_cap_table_user_idx ON fre_cap_table (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS fre_cap_table_asset_user_uidx ON fre_cap_table (asset_id, user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Investor profile, classification, suitability
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_investor_profiles (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    text NOT NULL UNIQUE,
    classification             text NOT NULL DEFAULT 'retail', -- retail|hni|qualified
    declared_annual_income_kobo bigint NOT NULL DEFAULT 0 CHECK (declared_annual_income_kobo >= 0),
    -- ytd_invested_kobo is a PROJECTION reconciled from subscriptions+secondary
    -- buys+auto-invest within the calendar year; cached here for fast cap checks.
    ytd_invested_kobo          bigint NOT NULL DEFAULT 0 CHECK (ytd_invested_kobo >= 0),
    ytd_year                   int NOT NULL DEFAULT 0,        -- calendar year the YTD figure applies to
    suitability_score          int NOT NULL DEFAULT 0,
    suitability_answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
    suitability_completed_at   timestamptz,
    master_risk_ack_id         uuid,                          -- master risk acknowledgement
    status                     text NOT NULL DEFAULT 'inactive', -- inactive|active|suspended
    activated_at               timestamptz,
    classified_by              text,                          -- admin who set classification (audit)
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_investor_profiles_user_idx ON fre_investor_profiles (user_id);
CREATE INDEX IF NOT EXISTS fre_investor_profiles_class_idx ON fre_investor_profiles (classification);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Risk acknowledgements (master + per-offer; scroll-gated + timestamp)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_risk_acknowledgements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         text NOT NULL,
    offering_id     uuid REFERENCES fre_offerings(id),  -- NULL = master acknowledgement
    scope           text NOT NULL DEFAULT 'offer',      -- master|offer
    disclosure_ref  text,                               -- version/hash of disclosure shown
    scroll_completed boolean NOT NULL DEFAULT false,    -- scroll-gated
    acknowledged_at timestamptz NOT NULL DEFAULT now(),
    ip_address      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_risk_ack_user_idx ON fre_risk_acknowledgements (user_id);
CREATE INDEX IF NOT EXISTS fre_risk_ack_offering_idx ON fre_risk_acknowledgements (offering_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Distributions (maker-checker payout runs)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_distributions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id           uuid NOT NULL REFERENCES fre_assets(id),
    offering_id        uuid REFERENCES fre_offerings(id),
    period_label       text,                          -- e.g. "2026-Q2"
    gross_kobo         bigint NOT NULL CHECK (gross_kobo >= 0),
    fee_kobo           bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
    withholding_kobo   bigint NOT NULL DEFAULT 0 CHECK (withholding_kobo >= 0),
    net_kobo           bigint NOT NULL DEFAULT 0 CHECK (net_kobo >= 0), -- gross - fee - withholding
    -- status: draft|submitted|approved|paid|partial|failed
    status             text NOT NULL DEFAULT 'draft',
    maker_id           text,                          -- scheduled/submitted by
    checker_id         text,                          -- approved by (MUST differ from maker_id)
    submitted_at       timestamptz,
    approved_at        timestamptz,
    paid_at            timestamptz,
    idempotency_key    text NOT NULL UNIQUE,          -- run-level idempotency
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_distributions_asset_idx ON fre_distributions (asset_id);
CREATE INDEX IF NOT EXISTS fre_distributions_status_idx ON fre_distributions (status);

-- Per-investor distribution payment line (idempotent; reconciled; retryable).
CREATE TABLE IF NOT EXISTS fre_distribution_payments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    distribution_id uuid NOT NULL REFERENCES fre_distributions(id),
    user_id         text NOT NULL,
    units           bigint NOT NULL CHECK (units >= 0),
    gross_kobo      bigint NOT NULL DEFAULT 0 CHECK (gross_kobo >= 0),
    withholding_kobo bigint NOT NULL DEFAULT 0 CHECK (withholding_kobo >= 0),
    net_kobo        bigint NOT NULL CHECK (net_kobo >= 0),
    -- status: pending|paid|failed|excluded
    status          text NOT NULL DEFAULT 'pending',
    excluded_reason text,                             -- exception-list reason (preview)
    idempotency_key text NOT NULL UNIQUE,             -- per-line credit idempotency
    paid_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_dist_payments_dist_idx ON fre_distribution_payments (distribution_id);
CREATE INDEX IF NOT EXISTS fre_dist_payments_user_idx ON fre_distribution_payments (user_id);
CREATE INDEX IF NOT EXISTS fre_dist_payments_status_idx ON fre_distribution_payments (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Secondary market (NAV-anchored fraction resale)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_secondary_listings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id        uuid NOT NULL REFERENCES fre_assets(id),
    seller_id       text NOT NULL,
    units           bigint NOT NULL CHECK (units > 0),
    units_remaining bigint NOT NULL CHECK (units_remaining >= 0),
    unit_price_kobo bigint NOT NULL CHECK (unit_price_kobo > 0), -- NAV-anchored at list time
    nav_at_list_kobo bigint NOT NULL DEFAULT 0,
    -- status: active|filled|cancelled|halted
    status          text NOT NULL DEFAULT 'active',
    halted_reason   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_listings_asset_idx ON fre_secondary_listings (asset_id);
CREATE INDEX IF NOT EXISTS fre_listings_seller_idx ON fre_secondary_listings (seller_id);
CREATE INDEX IF NOT EXISTS fre_listings_status_idx ON fre_secondary_listings (status);

CREATE TABLE IF NOT EXISTS fre_secondary_orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      uuid NOT NULL REFERENCES fre_secondary_listings(id),
    asset_id        uuid NOT NULL REFERENCES fre_assets(id),
    buyer_id        text NOT NULL,
    seller_id       text NOT NULL,
    units           bigint NOT NULL CHECK (units > 0),
    amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
    fee_kobo        bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
    -- status: escrowed|settled|refunded|failed
    status          text NOT NULL DEFAULT 'escrowed',
    settlement_id   text,
    idempotency_key text NOT NULL UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_orders_listing_idx ON fre_secondary_orders (listing_id);
CREATE INDEX IF NOT EXISTS fre_orders_buyer_idx ON fre_secondary_orders (buyer_id);

-- Platform-wide secondary-market controls (single-row config).
CREATE TABLE IF NOT EXISTS fre_market_controls (
    id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    trading_enabled boolean NOT NULL DEFAULT true,
    fee_bps         int NOT NULL DEFAULT 100 CHECK (fee_bps >= 0), -- 1.00% default
    updated_by      text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fre_market_controls (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Watchlist, goals, auto-invest, documents
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_watchlist (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     text NOT NULL,
    offering_id uuid NOT NULL REFERENCES fre_offerings(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fre_watchlist_uidx ON fre_watchlist (user_id, offering_id);

CREATE TABLE IF NOT EXISTS fre_goals (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         text NOT NULL,
    name            text NOT NULL,
    target_kobo     bigint NOT NULL DEFAULT 0 CHECK (target_kobo >= 0),
    saved_kobo      bigint NOT NULL DEFAULT 0 CHECK (saved_kobo >= 0),
    target_date     date,
    status          text NOT NULL DEFAULT 'active', -- active|achieved|cancelled
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_goals_user_idx ON fre_goals (user_id);

CREATE TABLE IF NOT EXISTS fre_auto_invest (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         text NOT NULL,
    amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
    cadence         text NOT NULL DEFAULT 'monthly', -- weekly|monthly
    asset_type      text,                            -- optional preference filter
    status          text NOT NULL DEFAULT 'active',  -- active|paused
    next_run_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_auto_invest_user_idx ON fre_auto_invest (user_id);

CREATE TABLE IF NOT EXISTS fre_documents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id    uuid REFERENCES fre_assets(id),
    offering_id uuid REFERENCES fre_offerings(id),
    user_id     text,                                -- investor-scoped doc (e.g. certificate); NULL = public/asset doc
    doc_type    text NOT NULL,                       -- title|c_of_o|deed|prospectus|certificate|statement|other
    object_key  text NOT NULL,                       -- R2 object key
    label       text,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_documents_asset_idx ON fre_documents (asset_id);
CREATE INDEX IF NOT EXISTS fre_documents_user_idx ON fre_documents (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Limit overrides + compliance log (immutable audit of cap overrides)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_limit_overrides (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      text NOT NULL,
    override_kobo bigint NOT NULL DEFAULT 0 CHECK (override_kobo >= 0), -- additional headroom granted
    reason       text NOT NULL,
    approved_by  text NOT NULL,                       -- compliance officer (audit)
    expires_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_limit_overrides_user_idx ON fre_limit_overrides (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Module audit log (immutable; append-only) — mirrors realtor_admin_audit_log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fre_audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    text NOT NULL,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   text,
    old_value   jsonb,
    new_value   jsonb,
    reason      text,
    ip_address  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fre_audit_entity_idx ON fre_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS fre_audit_created_idx ON fre_audit_log (created_at DESC);
