-- Paymax Invest · Crypto — compliance/eligibility tables (expand-only).
--
-- Wires the real trading gate (docs/compliance.md): a user may only trade once
-- they clear KYC tier + suitability + active agreements + product flag. The
-- users.kyc_tier / users.crypto_enabled columns already exist (000001); this
-- migration adds:
--   * users.status            — active | suspended | closed (gate: user active)
--   * suitability_profiles     — riskCategory + eligibleProducts + expiry
--   * required_agreements      — the currently-required agreement versions
--   * agreement_acceptances    — per-user, per-version acceptance log (audited)
--
-- All additive. No DROP / rename / type-narrowing. Money stays out of these
-- tables (compliance facts only).

BEGIN;

-- Account status feeds the "user active" pre-trade check. Default 'active' keeps
-- existing rows eligible; suspended/closed accounts fail the gate.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed'));

-- ── Suitability profiles ──────────────────────────────────────────────────────
-- The questionnaire produces a risk_category + the set of eligible_products. A
-- profile expires (expires_at); a lapsed profile must be retaken before trading.
CREATE TABLE IF NOT EXISTS suitability_profiles (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    risk_category       TEXT NOT NULL,                 -- conservative | balanced | growth …
    eligible_products   JSONB NOT NULL DEFAULT '[]',   -- e.g. ["stock","crypto"]
    expires_at          TIMESTAMPTZ,                   -- NULL = non-expiring
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suitability_user_created
    ON suitability_profiles (user_id, created_at DESC);

-- ── Required agreements (the active version set users must accept) ────────────
CREATE TABLE IF NOT EXISTS required_agreements (
    code        TEXT NOT NULL,            -- e.g. 'crypto_partner_terms'
    version     TEXT NOT NULL,            -- e.g. 'v2'
    label       TEXT NOT NULL DEFAULT '',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (code, version)
);

-- ── Agreement acceptance log (versioned + re-acceptance logged) ───────────────
CREATE TABLE IF NOT EXISTS agreement_acceptances (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    version     TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code, version)
);
CREATE INDEX IF NOT EXISTS idx_agreement_acceptances_user
    ON agreement_acceptances (user_id);

COMMIT;
