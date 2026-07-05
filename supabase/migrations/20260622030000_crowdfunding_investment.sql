-- Crowdfunding — Investment (Section L) schema (additive-only).
-- Regulated module, feature-flagged OFF until licensed (FEATURE_CROWDFUNDING_ENABLED
-- + INVESTMENT_ENABLED). Adds investment offers, per-investor onboarding profiles,
-- subscriptions, and seeded investor education + quiz content.
-- IRON RULES: no DROP of existing objects, no RENAME, no type narrowing. All money is
-- BIGINT kobo. Onboarding gate (kyc + education + quiz + risk profile) is enforced
-- server-side before a subscription can be created. RLS owner-scoped + service_role bypass.

-- ─── investment offers ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cf_investment_offers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                TEXT NOT NULL,
    issuer_name          TEXT NOT NULL,
    issuer_verified      BOOLEAN NOT NULL DEFAULT FALSE,
    model                TEXT NOT NULL DEFAULT 'EQUITY'
        CHECK (model IN ('EQUITY','DEBT','REVENUE_SHARE')),
    summary              TEXT NOT NULL DEFAULT '',
    cover_image          TEXT,
    target_kobo          BIGINT NOT NULL DEFAULT 0,
    raised_kobo          BIGINT NOT NULL DEFAULT 0,
    min_ticket_kobo      BIGINT NOT NULL DEFAULT 0,
    investor_count       INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','CLOSING_SOON','CLOSED','FUNDED')),
    closes_at            TIMESTAMPTZ,
    projected_return_pct INTEGER NOT NULL DEFAULT 0,
    term_months          INTEGER NOT NULL DEFAULT 0,
    risk_level           TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK (risk_level IN ('MEDIUM','HIGH')),
    lock_in_months       INTEGER NOT NULL DEFAULT 0,
    cooling_off_days     INTEGER NOT NULL DEFAULT 0,
    sector               TEXT NOT NULL DEFAULT '',
    location             TEXT NOT NULL DEFAULT '',
    offer_document_label TEXT NOT NULL DEFAULT 'Offer memorandum (PDF)',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cf_investment_offers_status_idx ON cf_investment_offers(status);

-- Seed two offers (idempotent on fixed UUIDs).
INSERT INTO cf_investment_offers
    (id, title, issuer_name, issuer_verified, model, summary, cover_image, target_kobo,
     raised_kobo, min_ticket_kobo, investor_count, status, closes_at, projected_return_pct,
     term_months, risk_level, lock_in_months, cooling_off_days, sector, location,
     offer_document_label)
VALUES
    ('a1111111-1111-1111-1111-111111111111',
     'GreenField Agritech Series A', 'GreenField Foods Ltd', TRUE, 'EQUITY',
     'Equity stake in a fast-growing Nigerian agritech scaling cold-chain logistics.',
     NULL, 5000000000, 1250000000, 5000000, 38, 'OPEN',
     NOW() + INTERVAL '45 days', 22, 36, 'HIGH', 24, 14, 'Agriculture', 'Lagos, NG',
     'Offer memorandum (PDF)'),
    ('b2222222-2222-2222-2222-222222222222',
     'SolarPay Working-Capital Note', 'SolarPay Energy Plc', TRUE, 'DEBT',
     'Fixed-income note funding solar-asset deployment with monthly coupon.',
     NULL, 2000000000, 1700000000, 2500000, 121, 'CLOSING_SOON',
     NOW() + INTERVAL '9 days', 14, 18, 'MEDIUM', 12, 7, 'Energy', 'Abuja, NG',
     'Offer memorandum (PDF)')
ON CONFLICT (id) DO NOTHING;

-- ─── per-investor onboarding profile ─────────────────────────────────────────
-- annual_limit_kobo defaults to ₦10,000,000 (1_000_000_000 kobo) regulatory cap.
CREATE TABLE IF NOT EXISTS cf_investor_profiles (
    user_id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    onboarded                BOOLEAN NOT NULL DEFAULT FALSE,
    kyc_complete             BOOLEAN NOT NULL DEFAULT FALSE,
    education_complete       BOOLEAN NOT NULL DEFAULT FALSE,
    quiz_passed              BOOLEAN NOT NULL DEFAULT FALSE,
    risk_profile             TEXT
        CHECK (risk_profile IS NULL OR risk_profile IN ('CONSERVATIVE','BALANCED','AGGRESSIVE')),
    annual_limit_kobo        BIGINT NOT NULL DEFAULT 1000000000,
    invested_this_year_kobo  BIGINT NOT NULL DEFAULT 0,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── subscriptions (money mutations — idempotency-keyed) ─────────────────────
CREATE TABLE IF NOT EXISTS cf_investment_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    offer_id        UUID NOT NULL REFERENCES cf_investment_offers(id),
    amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
    units_or_pct    TEXT NOT NULL DEFAULT '',
    reference       TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','EXITED','DEFAULTED')),
    invested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lock_in_until   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cf_investment_subscriptions_user_idx  ON cf_investment_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS cf_investment_subscriptions_offer_idx ON cf_investment_subscriptions(offer_id);

-- ─── investor education modules (seeded content) ─────────────────────────────
CREATE TABLE IF NOT EXISTS cf_investor_education (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    minutes    INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cf_investor_education (id, title, body, minutes, sort_order) VALUES
    ('edu-risk', 'Understanding investment risk',
     'Investments are not savings. Capital is at risk and you may get back less than you invested. Returns are indicative, never guaranteed, and past performance does not predict future results.',
     3, 1),
    ('edu-liquidity', 'Lock-in and liquidity',
     'Most offers carry a lock-in period during which you cannot exit. Only invest money you will not need during the term. A cooling-off window lets you cancel shortly after subscribing.',
     2, 2),
    ('edu-diversify', 'Diversification and limits',
     'Never concentrate your portfolio in a single offer. Regulatory annual limits cap how much you can invest across all offers in a year to protect retail investors.',
     2, 3)
ON CONFLICT (id) DO NOTHING;

-- ─── investor suitability quiz (seeded content) ──────────────────────────────
CREATE TABLE IF NOT EXISTS cf_investor_quiz (
    id            TEXT PRIMARY KEY,
    question      TEXT NOT NULL,
    options       JSONB NOT NULL,
    correct_index INTEGER NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cf_investor_quiz (id, question, options, correct_index, sort_order) VALUES
    ('q-capital', 'Can you lose money investing in these offers?',
     '["No, returns are guaranteed","Yes, capital is at risk","Only if the issuer agrees","Never with verified issuers"]'::jsonb,
     1, 1),
    ('q-lockin', 'During a lock-in period you can:',
     '["Withdraw any time","Not exit until the term ends","Double your stake","Convert to cash instantly"]'::jsonb,
     1, 2),
    ('q-returns', 'A projected return percentage is:',
     '["A guaranteed payout","An indicative estimate, not guaranteed","Set by the regulator","Always paid monthly"]'::jsonb,
     1, 3)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cf_investment_offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_investor_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_investment_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_investor_education       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cf_investor_quiz            ENABLE ROW LEVEL SECURITY;

-- Offers are public read to authenticated users.
DROP POLICY IF EXISTS "cf_offers_select" ON cf_investment_offers;
CREATE POLICY "cf_offers_select" ON cf_investment_offers FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_offers_service" ON cf_investment_offers;
CREATE POLICY "cf_offers_service" ON cf_investment_offers TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Education + quiz are public read (suitability content), service_role write.
DROP POLICY IF EXISTS "cf_education_select" ON cf_investor_education;
CREATE POLICY "cf_education_select" ON cf_investor_education FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_education_service" ON cf_investor_education;
CREATE POLICY "cf_education_service" ON cf_investor_education TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "cf_quiz_select" ON cf_investor_quiz;
CREATE POLICY "cf_quiz_select" ON cf_investor_quiz FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "cf_quiz_service" ON cf_investor_quiz;
CREATE POLICY "cf_quiz_service" ON cf_investor_quiz TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Profiles are owner-scoped: a user sees/manages only their own row.
DROP POLICY IF EXISTS "cf_investor_profiles_owner" ON cf_investor_profiles;
CREATE POLICY "cf_investor_profiles_owner" ON cf_investor_profiles
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_investor_profiles_service" ON cf_investor_profiles;
CREATE POLICY "cf_investor_profiles_service" ON cf_investor_profiles TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Subscriptions are owner-scoped read; writes go through the service_role backend.
DROP POLICY IF EXISTS "cf_subscriptions_owner" ON cf_investment_subscriptions;
CREATE POLICY "cf_subscriptions_owner" ON cf_investment_subscriptions
    FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "cf_subscriptions_service" ON cf_investment_subscriptions;
CREATE POLICY "cf_subscriptions_service" ON cf_investment_subscriptions TO service_role USING (TRUE) WITH CHECK (TRUE);
